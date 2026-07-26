import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { getClientBookingUrl, getClientRestaurantName } from '../lib/clientPublicData.ts';
import { sendEvolutionText } from '../lib/evolution.ts';
import {
  appendSheetValues,
  createGoogleAccessToken,
  fetchSheetValues,
  updateSheetCell,
} from '../lib/googleSheets.ts';
import {
  buildFeedbackAppendRow,
  findFeedbackReservation,
  getFeedbackAlertPhone,
  hasFeedbackForReservation,
  normalizeFeedbackReservations,
  normalizeFeedbackRows,
  normalizeFeedbackSubmit,
  normalizeSettings,
} from '../lib/feedback.ts';
import { toStringValue } from '../lib/normalization.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { buildFeedbackAlertMessage } from '../templates/feedbackAlert.ts';

type FeedbackRouteMode = 'details' | 'submit';

function getMissingAuthFields(body: Record<string, unknown>) {
  return [
    !toStringValue(body.client_id ?? body.clientId) ? 'client_id' : '',
    !toStringValue(body.public_token ?? body.publicToken) ? 'public_token' : '',
    !toStringValue(body.id_reserva ?? body.idReserva ?? body.ID_RESERVA) ? 'id_reserva' : '',
  ].filter(Boolean);
}

function getIdReserva(body: Record<string, unknown>) {
  return toStringValue(body.id_reserva ?? body.idReserva ?? body.ID_RESERVA);
}

function getSafeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('GOOGLE_AUTH_ERROR')) return 'GOOGLE_AUTH_ERROR';
  if (message.startsWith('GOOGLE_SHEETS_ERROR')) return 'GOOGLE_SHEETS_ERROR';
  if (message === 'GOOGLE_SECRET_MISSING' || message === 'GOOGLE_SECRET_INVALID') return message;
  return 'INTERNAL_ERROR';
}

function buildBranding(client: Record<string, unknown>) {
  const restaurantName = getClientRestaurantName(client, 'es');
  return {
    restaurante: restaurantName,
    restaurantName,
    color: toStringValue(client.primary_color),
    primaryColor: toStringValue(client.primary_color),
    logo: toStringValue(client.logo_url),
    logoUrl: toStringValue(client.logo_url),
    bookingUrl: getClientBookingUrl(client),
    fondo: '',
    backgroundImageUrl: '',
  };
}

function buildReviewLinks() {
  return {
    google: '',
    tripadvisor: '',
  };
}

async function loadFeedbackContext(sheetId: string, accessToken: string) {
  const [reservationsData, feedbacksData, settingsData] = await Promise.all([
    fetchSheetValues(sheetId, 'RESERVAS!A:Z', accessToken),
    fetchSheetValues(sheetId, 'FEEDBACKS!A:Z', accessToken),
    fetchSheetValues(sheetId, 'SETTINGS!A:Z', accessToken),
  ]);

  return {
    reservations: normalizeFeedbackReservations(reservationsData.values),
    feedbacks: normalizeFeedbackRows(feedbacksData.values),
    settings: normalizeSettings(settingsData.values),
  };
}

export async function handleFeedback(request: Request, dbClient: DbClient, mode: FeedbackRouteMode) {
  if (request.method !== 'POST') {
    return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return errorResponse(request, 'INVALID_REQUEST', 400, { missing_fields: ['body'] });
  }

  const missingFields = getMissingAuthFields(body);
  if (missingFields.length > 0) {
    return errorResponse(request, 'INVALID_REQUEST', 400, { missing_fields: missingFields });
  }

  const context = await validatePublicClient(request, dbClient, body, {
    missingFieldsError: 'INVALID_REQUEST',
    invalidClientError: 'INVALID_CLIENT',
    inactiveLicenseError: 'INVALID_CLIENT',
  });
  if ('error' in context) {
    return context.error;
  }

  if (!context.sheetId) {
    return errorResponse(request, 'INVALID_CLIENT', 404);
  }

  let accessToken = '';
  try {
    accessToken = await createGoogleAccessToken();
  } catch (error) {
    console.error('[PUBLIC_API][FEEDBACK][GOOGLE_AUTH_FAILED]', {
      clientId: context.clientId,
      error: getSafeErrorCode(error),
    });
    return errorResponse(request, 'GOOGLE_AUTH_ERROR', 500);
  }

  let feedbackContext: Awaited<ReturnType<typeof loadFeedbackContext>>;
  try {
    feedbackContext = await loadFeedbackContext(context.sheetId, accessToken);
  } catch (error) {
    console.error('[PUBLIC_API][FEEDBACK][SHEETS_READ_FAILED]', {
      clientId: context.clientId,
      error: getSafeErrorCode(error),
    });
    return errorResponse(request, 'SHEETS_READ_FAILED', 502);
  }

  const idReserva = getIdReserva(body);
  const reservation = findFeedbackReservation(feedbackContext.reservations, idReserva);
  const alreadySubmitted = hasFeedbackForReservation(feedbackContext.feedbacks, idReserva);
  const branding = buildBranding(context.client);
  const reviewLinks = buildReviewLinks();

  if (mode === 'details') {
    if (!reservation) {
      return jsonResponse(request, {
        ok: true,
        encontrada: false,
      });
    }

    return jsonResponse(request, {
      ok: true,
      encontrada: true,
      already_submitted: alreadySubmitted,
      reservation: {
        id_reserva: reservation.idReserva,
        nombre: reservation.nombre,
        fecha: reservation.fecha,
        hora: reservation.hora,
        telefono: reservation.telefono,
        personas: reservation.personas,
        habitacion: reservation.habitacion,
        idioma: reservation.idioma.toUpperCase(),
        servicio: reservation.servicio,
      },
      branding,
      review_links: reviewLinks,
    });
  }

  if (!reservation) {
    return errorResponse(request, 'RESERVATION_NOT_FOUND', 404);
  }

  const { normalized, missingFields: submitMissingFields, invalidFields } = normalizeFeedbackSubmit(body, reservation);
  if (!normalized || submitMissingFields.length > 0 || invalidFields.length > 0) {
    return errorResponse(request, 'INVALID_REQUEST', 400, {
      ...(submitMissingFields.length > 0 ? { missing_fields: submitMissingFields } : {}),
      ...(invalidFields.length > 0 ? { invalid_fields: invalidFields } : {}),
    });
  }

  if (alreadySubmitted) {
    return jsonResponse(request, {
      ok: false,
      already_submitted: true,
    }, 409);
  }

  try {
    await appendSheetValues(context.sheetId, 'FEEDBACKS!A:H', [buildFeedbackAppendRow(reservation, normalized)], accessToken);
  } catch (error) {
    console.error('[PUBLIC_API][FEEDBACK][SAVE_FAILED]', {
      clientId: context.clientId,
      reservationId: reservation.idReserva,
      error: getSafeErrorCode(error),
    });
    return errorResponse(request, 'FEEDBACK_SAVE_FAILED', 500);
  }

  const positive = normalized.puntuacion >= 4;
  if (positive) {
    return jsonResponse(request, {
      ok: true,
      feedback_saved: true,
      positive: true,
      redirect_options: reviewLinks,
    });
  }

  const alertPhone = getFeedbackAlertPhone(feedbackContext.settings);
  if (!alertPhone) {
    return jsonResponse(request, {
      ok: true,
      feedback_saved: true,
      positive: false,
      alert_sent: false,
      warning: 'FEEDBACK_ALERT_NOT_SENT',
    });
  }

  try {
    await sendEvolutionText(alertPhone, buildFeedbackAlertMessage(reservation, normalized));
  } catch (error) {
    console.error('[PUBLIC_API][FEEDBACK][ALERT_SEND_FAILED]', {
      clientId: context.clientId,
      reservationId: reservation.idReserva,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(request, {
      ok: true,
      feedback_saved: true,
      positive: false,
      alert_sent: false,
      warning: 'FEEDBACK_ALERT_NOT_SENT',
    });
  }

  return jsonResponse(request, {
    ok: true,
    feedback_saved: true,
    positive: false,
    alert_sent: true,
  });
}
