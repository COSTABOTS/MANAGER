import type { DbClient } from '../lib/clients.ts';
import { sendEvolutionText } from '../lib/evolution.ts';
import { createGoogleAccessToken, fetchSheetValues, updateSheetCell } from '../lib/googleSheets.ts';
import { normalizeDispatchClients } from '../lib/feedbackDispatch.ts';
import {
  getCurrentMadridClock,
  getPreDinnerMessageConfig,
  normalizePendingReservationReminders,
} from '../lib/reservationRemindersDispatch.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { buildReservationReminderEN } from '../templates/reservationReminderEN.ts';
import { buildReservationReminderES } from '../templates/reservationReminderES.ts';

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

function buildReminderMessage(params: {
  idReserva: string;
  clientId: string;
  publicToken: string;
  nombre: string;
  hora: string;
  personas: number;
  restaurantName: string;
  idioma: 'es' | 'en';
}) {
  if (params.idioma === 'en') {
    return buildReservationReminderEN(params);
  }

  return buildReservationReminderES(params);
}

export async function handleReservationRemindersDispatch(request: Request, dbClient: DbClient) {
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
  const force = body.force === true;
  const clock = getCurrentMadridClock(body);
  const nowUtc = new Date().toISOString();
  let messagesSent = 0;
  let messagesFailed = 0;
  let reservationsFound = 0;
  let clientsSkippedDisabled = 0;
  let reservationsSkippedLateCreation = 0;
  let reservationsSkippedAlreadySent = 0;
  let reservationsSkippedBalinesa = 0;
  const errors: Array<{ client_id: string; id_reserva?: string; code: string }> = [];

  const { data: rawClients, error: clientsError } = await dbClient
    .from('CLIENTES')
    .select('client_id, rest_name, status, sheet_id, public_token, booking_url, public_url, bot_url, contact_phone')
    .not('sheet_id', 'is', null);

  if (clientsError) {
    console.error('[PUBLIC_API][RESERVATION_REMINDERS][CLIENTS_FAILED]', {
      error: clientsError.message,
    });
    return errorResponse(request, 'CLIENTS_READ_FAILED', 500);
  }

  const clients = normalizeDispatchClients(rawClients as Array<Record<string, unknown>> | null | undefined);

  let accessToken = '';
  try {
    accessToken = await createGoogleAccessToken();
  } catch (error) {
    console.error('[PUBLIC_API][RESERVATION_REMINDERS][GOOGLE_AUTH_FAILED]', {
      error: getSafeErrorCode(error),
    });
    return errorResponse(request, 'GOOGLE_AUTH_ERROR', 500);
  }

  for (const client of clients) {
    let settingsData: { values?: unknown[][] };
    try {
      settingsData = await fetchSheetValues(client.sheetId, 'SETTINGS!A:Z', accessToken);
    } catch (error) {
      console.error('[PUBLIC_API][RESERVATION_REMINDERS][SETTINGS_READ_FAILED]', {
        clientId: client.clientId,
        error: getSafeErrorCode(error),
      });
      errors.push({ client_id: client.clientId, code: 'SETTINGS_READ_FAILED' });
      continue;
    }

    const preDinnerConfig = getPreDinnerMessageConfig(settingsData.values);
    console.log('[PRE_DINNER][CLIENT]', {
      client_id: client.clientId,
      enabled: preDinnerConfig.enabled,
      minutes: preDinnerConfig.minutes,
      timezone: 'Europe/Madrid',
      now_utc: nowUtc,
      now_local: `${clock.date} ${clock.time}`,
    });
    if (!preDinnerConfig.enabled) {
      clientsSkippedDisabled += 1;
      continue;
    }
    if (preDinnerConfig.usedFallbackMinutes) {
      console.warn('[PUBLIC_API][RESERVATION_REMINDERS][MINUTES_FALLBACK]', {
        clientId: client.clientId,
      });
    }

    let reservationsData: { values?: unknown[][] };
    try {
      reservationsData = await fetchSheetValues(client.sheetId, 'RESERVAS!A:Z', accessToken);
    } catch (error) {
      console.error('[PUBLIC_API][RESERVATION_REMINDERS][SHEETS_READ_FAILED]', {
        clientId: client.clientId,
        error: getSafeErrorCode(error),
      });
      messagesFailed += 1;
      errors.push({ client_id: client.clientId, code: 'SHEETS_READ_FAILED' });
      continue;
    }

    const skipStats = { lateCreation: 0, alreadySent: 0, balinesa: 0 };
    const reservations = normalizePendingReservationReminders(
      reservationsData.values,
      clock,
      preDinnerConfig.minutes,
      force,
      skipStats,
      (entry) => {
        console.log('[PRE_DINNER][RESERVATION]', {
          client_id: client.clientId,
          ...entry,
        });
      },
    );
    reservationsFound += reservations.length;
    reservationsSkippedLateCreation += skipStats.lateCreation;
    reservationsSkippedAlreadySent += skipStats.alreadySent;
    reservationsSkippedBalinesa += skipStats.balinesa;

    for (const reservation of reservations) {
      const safeLanguage = reservation.idioma === 'en' ? 'en' : 'es';
      if (reservation.languageFallback) {
        console.warn('[PUBLIC_API][RESERVATION_REMINDERS][LANGUAGE_FALLBACK]', {
          clientId: client.clientId,
          reservationId: reservation.idReserva,
        });
      }

      try {
        await sendEvolutionText(reservation.telefono, buildReminderMessage({
          idReserva: reservation.idReserva,
          clientId: client.clientId,
          publicToken: client.publicToken,
          nombre: reservation.nombre || 'Cliente',
          hora: reservation.hora,
          personas: reservation.personas,
          restaurantName: client.restaurantName || (safeLanguage === 'en' ? 'the restaurant' : 'el restaurante'),
          idioma: safeLanguage,
        }));
        console.log('[PRE_DINNER][SEND]', {
          client_id: client.clientId,
          id_reserva: reservation.idReserva,
          evolution_called: true,
          evolution_status: 'sent',
          sheet_updated: false,
        });
      } catch (error) {
        console.error('[PUBLIC_API][RESERVATION_REMINDERS][SEND_FAILED]', {
          clientId: client.clientId,
          reservationId: reservation.idReserva,
          error: getSafeErrorCode(error),
        });
        messagesFailed += 1;
        errors.push({ client_id: client.clientId, id_reserva: reservation.idReserva, code: 'EVOLUTION_SEND_FAILED' });
        continue;
      }

      try {
        await updateSheetCell(
          client.sheetId,
          `RESERVAS!${reservation.precenaEnviadoColumn}${reservation.rowNumber}`,
          'TRUE',
          accessToken,
        );
        messagesSent += 1;
        console.log('[PRE_DINNER][SEND]', {
          client_id: client.clientId,
          id_reserva: reservation.idReserva,
          evolution_called: true,
          evolution_status: 'sent',
          sheet_updated: true,
          sheet_cell: `RESERVAS!${reservation.precenaEnviadoColumn}${reservation.rowNumber}`,
        });
      } catch (error) {
        console.error('[PUBLIC_API][RESERVATION_REMINDERS][MARK_FAILED]', {
          clientId: client.clientId,
          reservationId: reservation.idReserva,
          error: getSafeErrorCode(error),
        });
        messagesFailed += 1;
        errors.push({ client_id: client.clientId, id_reserva: reservation.idReserva, code: 'PRECENA_MARK_FAILED' });
      }
    }
  }

  return jsonResponse(request, {
    ok: true,
    current_time_madrid: clock.time,
    target_date: clock.date,
    clients_processed: clients.length,
    clients_skipped_disabled: clientsSkippedDisabled,
    reservations_found: reservationsFound,
    messages_sent: messagesSent,
    messages_failed: messagesFailed,
    reservations_skipped_late_creation: reservationsSkippedLateCreation,
    reservations_skipped_already_sent: reservationsSkippedAlreadySent,
    reservations_skipped_balinesa: reservationsSkippedBalinesa,
    partial_success: messagesFailed > 0,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
