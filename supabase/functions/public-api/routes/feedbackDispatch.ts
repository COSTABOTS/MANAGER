import type { DbClient } from '../lib/clients.ts';
import { sendEvolutionText } from '../lib/evolution.ts';
import { createGoogleAccessToken, fetchSheetValues, updateSheetCell } from '../lib/googleSheets.ts';
import {
  formatTargetDate,
  getCurrentMadridTime,
  getPostDinnerMessageConfig,
  isWithinDispatchWindow,
  normalizeDispatchClients,
  normalizePendingFeedbackReservations,
  resolveTargetDate,
} from '../lib/feedbackDispatch.ts';
import { normalizeDateKey, toStringValue } from '../lib/normalization.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { buildFeedbackInvitationEN } from '../templates/feedbackInvitationEN.ts';
import { buildFeedbackInvitationES, buildFeedbackUrl, maskFeedbackUrl } from '../templates/feedbackInvitationES.ts';

function constantTimeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function getSafeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('GOOGLE_AUTH_ERROR')) return 'GOOGLE_AUTH_ERROR';
  if (message.startsWith('GOOGLE_SHEETS_ERROR')) return 'GOOGLE_SHEETS_ERROR';
  if (message.startsWith('EVOLUTION_HTTP_')) return message;
  if (message === 'EVOLUTION_ENV_MISSING') return message;
  if (message === 'GOOGLE_SECRET_MISSING' || message === 'GOOGLE_SECRET_INVALID') return message;
  return 'INTERNAL_ERROR';
}

function buildInvitationMessage(params: {
  idReserva: string;
  clientId: string;
  publicToken: string;
  nombre: string;
  restaurantName: string;
  idioma: 'es' | 'en';
}) {
  if (params.idioma === 'en') {
    return buildFeedbackInvitationEN(params);
  }

  return buildFeedbackInvitationES(params);
}

export async function handleFeedbackDispatch(request: Request, dbClient: DbClient) {
  if (request.method !== 'POST') {
    return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  }

  const expectedSecret = Deno.env.get('FEEDBACK_CRON_SECRET')?.trim() ?? '';
  const receivedSecret = request.headers.get('x-cron-secret')?.trim() ?? '';
  if (!expectedSecret) {
    return errorResponse(request, 'INTERNAL_ERROR', 500);
  }

  if (!constantTimeEqual(receivedSecret, expectedSecret)) {
    return errorResponse(request, 'UNAUTHORIZED', 401);
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const targetDateInput = body.target_date ?? body.targetDate;
  const force = body.force === true;
  const hasManualTargetDate = Boolean(toStringValue(targetDateInput));
  const normalizedTargetDateInput = normalizeDateKey(targetDateInput);
  if (hasManualTargetDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedTargetDateInput)) {
    return errorResponse(request, 'INVALID_TARGET_DATE', 400);
  }

  const targetDate = resolveTargetDate(targetDateInput);
  const currentTimeMadrid = getCurrentMadridTime();
  let messagesSent = 0;
  let messagesFailed = 0;
  let reservationsFound = 0;
  let reservationsSkipped = 0;
  let clientsSkippedDisabled = 0;
  let clientsSkippedTime = 0;
  const errors: Array<{ client_id: string; id_reserva?: string; code: string }> = [];

  const { data: rawClients, error: clientsError } = await dbClient
    .from('CLIENTES')
    .select('client_id, rest_name, status, sheet_id, public_token, booking_url, public_url, bot_url, contact_phone')
    .not('sheet_id', 'is', null);

  if (clientsError) {
    console.error('[PUBLIC_API][FEEDBACK_DISPATCH][CLIENTS_FAILED]', {
      error: clientsError.message,
    });
    return errorResponse(request, 'CLIENTS_READ_FAILED', 500);
  }

  const clients = normalizeDispatchClients(rawClients as Array<Record<string, unknown>> | null | undefined);

  let accessToken = '';
  try {
    accessToken = await createGoogleAccessToken();
  } catch (error) {
    console.error('[PUBLIC_API][FEEDBACK_DISPATCH][GOOGLE_AUTH_FAILED]', {
      error: getSafeErrorCode(error),
    });
    return errorResponse(request, 'GOOGLE_AUTH_ERROR', 500);
  }

  for (const client of clients) {
    let values: unknown[][] | undefined;
    try {
      const settingsData = await fetchSheetValues(client.sheetId, 'SETTINGS!A:Z', accessToken);
      const postDinnerConfig = getPostDinnerMessageConfig(settingsData.values);
      if (!postDinnerConfig.enabled) {
        clientsSkippedDisabled += 1;
        continue;
      }
      if (postDinnerConfig.usedFallbackTime) {
        console.warn('[PUBLIC_API][FEEDBACK_DISPATCH][TIME_FALLBACK]', {
          clientId: client.clientId,
        });
      }
      if (!force && !isWithinDispatchWindow(currentTimeMadrid, postDinnerConfig.time)) {
        clientsSkippedTime += 1;
        continue;
      }
    } catch (error) {
      const code = getSafeErrorCode(error);
      console.error('[PUBLIC_API][FEEDBACK_DISPATCH][SETTINGS_READ_FAILED]', {
        clientId: client.clientId,
        error: code,
      });
      errors.push({ client_id: client.clientId, code: 'SETTINGS_READ_FAILED' });
      continue;
    }

    try {
      const reservationsData = await fetchSheetValues(client.sheetId, 'RESERVAS!A:Z', accessToken);
      values = reservationsData.values;
    } catch (error) {
      const code = getSafeErrorCode(error);
      console.error('[PUBLIC_API][FEEDBACK_DISPATCH][SHEETS_READ_FAILED]', {
        clientId: client.clientId,
        error: code,
      });
      messagesFailed += 1;
      errors.push({ client_id: client.clientId, code: 'SHEETS_READ_FAILED' });
      continue;
    }

    const reservations = normalizePendingFeedbackReservations(values, targetDate);
    reservationsFound += reservations.length;

    for (const reservation of reservations) {
      const safeLanguage = reservation.idioma === 'en' ? 'en' : 'es';
      if (reservation.languageFallback) {
        console.warn('[PUBLIC_API][FEEDBACK_DISPATCH][LANGUAGE_FALLBACK]', {
          clientId: client.clientId,
          reservationId: reservation.idReserva,
        });
      }

      try {
        const messageParams = {
          idReserva: reservation.idReserva,
          clientId: client.clientId,
          publicToken: client.publicToken,
          nombre: reservation.nombre || 'Cliente',
          restaurantName: client.restaurantName || (safeLanguage === 'en' ? 'the restaurant' : 'el restaurante'),
          idioma: safeLanguage,
        };
        console.log('[PUBLIC_API][FEEDBACK][LINK_CONTEXT]', {
          client_id: client.clientId,
          id_reserva: reservation.idReserva,
          url: maskFeedbackUrl(buildFeedbackUrl(messageParams, safeLanguage)),
          idioma: safeLanguage,
        });
        await sendEvolutionText(reservation.telefono, buildInvitationMessage(messageParams));
      } catch (error) {
        const code = getSafeErrorCode(error);
        console.error('[PUBLIC_API][FEEDBACK_DISPATCH][SEND_FAILED]', {
          clientId: client.clientId,
          reservationId: reservation.idReserva,
          error: code,
        });
        messagesFailed += 1;
        errors.push({ client_id: client.clientId, id_reserva: reservation.idReserva, code: 'EVOLUTION_SEND_FAILED' });
        continue;
      }

      try {
        await updateSheetCell(
          client.sheetId,
          `RESERVAS!${reservation.feedbackEnviadoColumn}${reservation.rowNumber}`,
          'TRUE',
          accessToken,
        );
        messagesSent += 1;
      } catch (error) {
        const code = getSafeErrorCode(error);
        console.error('[PUBLIC_API][FEEDBACK_DISPATCH][MARK_FAILED]', {
          clientId: client.clientId,
          reservationId: reservation.idReserva,
          error: code,
        });
        messagesFailed += 1;
        errors.push({ client_id: client.clientId, id_reserva: reservation.idReserva, code: 'FEEDBACK_MARK_FAILED' });
      }
    }
  }

  return jsonResponse(request, {
    ok: true,
    target_date: formatTargetDate(targetDate),
    current_time_madrid: currentTimeMadrid,
    clients_processed: clients.length,
    reservations_found: reservationsFound,
    messages_sent: messagesSent,
    messages_failed: messagesFailed,
    reservations_skipped: reservationsSkipped,
    clients_skipped_disabled: clientsSkippedDisabled,
    clients_skipped_time: clientsSkippedTime,
    partial_success: messagesFailed > 0,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
