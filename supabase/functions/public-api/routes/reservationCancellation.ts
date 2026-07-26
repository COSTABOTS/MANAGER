import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { getPublicClientMessageData } from '../lib/clientPublicData.ts';
import {
  findCancellationReservation,
  getCancellationPhone,
  isCancelledReservation,
  isConfirmedReservation,
  normalizeCancellationReservations,
} from '../lib/cancellations.ts';
import { sendEvolutionText } from '../lib/evolution.ts';
import { createGoogleAccessToken, fetchSheetValues, updateSheetCell } from '../lib/googleSheets.ts';
import { toStringValue } from '../lib/normalization.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { buildReservationCancellationEN } from '../templates/reservationCancellationEN.ts';
import { buildReservationCancellationES } from '../templates/reservationCancellationES.ts';

type CancellationRouteMode = 'details' | 'confirm';

function getMissingFields(body: Record<string, unknown>) {
  return [
    !toStringValue(body.client_id ?? body.clientId) ? 'client_id' : '',
    !toStringValue(body.public_token ?? body.publicToken) ? 'public_token' : '',
    !toStringValue(body.id_reserva ?? body.idReserva ?? body.ID_RESERVA) ? 'id_reserva' : '',
  ].filter(Boolean);
}

function getIdReserva(body: Record<string, unknown>) {
  return toStringValue(body.id_reserva ?? body.idReserva ?? body.ID_RESERVA);
}

function buildCancellationMessage(reservation: ReturnType<typeof normalizeCancellationReservations>[number], client: Record<string, unknown>) {
  const clientMessageData = getPublicClientMessageData(client, reservation.idioma);
  const options = {
    restaurantName: clientMessageData.restaurantName,
    bookingUrl: clientMessageData.bookingUrl,
  };

  return reservation.idioma === 'en'
    ? buildReservationCancellationEN(reservation, options)
    : buildReservationCancellationES(reservation, options);
}

function getSafeGoogleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('GOOGLE_AUTH_ERROR')) {
    return 'GOOGLE_AUTH_ERROR';
  }
  if (message.startsWith('GOOGLE_SHEETS_ERROR')) {
    return 'GOOGLE_SHEETS_ERROR';
  }
  if (message === 'GOOGLE_SECRET_MISSING' || message === 'GOOGLE_SECRET_INVALID') {
    return message;
  }

  return 'INTERNAL_ERROR';
}

async function loadCancellationReservations(sheetId: string, accessToken: string) {
  try {
    const sheetsData = await fetchSheetValues(sheetId, 'RESERVAS!A:Z', accessToken);
    return normalizeCancellationReservations(sheetsData.values);
  } catch (error) {
    console.error('[PUBLIC_API][CANCELLATION][SHEETS_READ_FAILED]', {
      error: getSafeGoogleError(error),
    });
    return null;
  }
}

export async function handleReservationCancellation(request: Request, dbClient: DbClient, mode: CancellationRouteMode) {
  if (request.method !== 'POST') {
    return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return errorResponse(request, 'INVALID_REQUEST', 400, { missing_fields: ['body'] });
  }

  const missingFields = getMissingFields(body);
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
    console.error('[PUBLIC_API][CANCELLATION][GOOGLE_AUTH_FAILED]', {
      error: getSafeGoogleError(error),
    });
    return errorResponse(request, 'GOOGLE_AUTH_ERROR', 500);
  }

  const rows = await loadCancellationReservations(context.sheetId, accessToken);
  if (!rows) {
    return errorResponse(request, 'SHEETS_READ_FAILED', 502);
  }

  const reservation = findCancellationReservation(rows, getIdReserva(body));

  if (mode === 'details') {
    if (!isConfirmedReservation(reservation)) {
      return jsonResponse(request, { encontrada: false });
    }

    const clientMessageData = getPublicClientMessageData(context.client, reservation.idioma);

    return jsonResponse(request, {
      encontrada: true,
      restaurante: clientMessageData.restaurantName,
      nombre: reservation.nombre,
      fecha: reservation.fecha,
      hora: reservation.hora,
      telefono: reservation.telefono,
      personas: reservation.personas,
      idioma: reservation.idioma.toUpperCase(),
      servicio: reservation.servicio,
      paquete_balinesa: reservation.paqueteBalinesa,
      recurso: reservation.recurso,
      logo_url: toStringValue(context.client.logo_url),
      primaryColor: toStringValue(context.client.primary_color),
    });
  }

  if (isCancelledReservation(reservation)) {
    return jsonResponse(request, {
      ok: false,
      already_cancelled: true,
    });
  }

  if (!isConfirmedReservation(reservation)) {
    return jsonResponse(request, {
      ok: false,
      encontrada: false,
    });
  }

  try {
    await updateSheetCell(context.sheetId, `RESERVAS!I${reservation.rowNumber}`, 'CANCELADA', accessToken);
  } catch (error) {
    console.error('[PUBLIC_API][CANCELLATION][STATUS_UPDATE_FAILED]', {
      reservationId: reservation.idReserva,
      error: getSafeGoogleError(error),
    });
    return errorResponse(request, 'CANCELLATION_UPDATE_FAILED', 502);
  }

  const phone = getCancellationPhone(reservation);
  if (phone) {
    try {
      await sendEvolutionText(phone, buildCancellationMessage(reservation, context.client));
    } catch (error) {
      console.error('[PUBLIC_API][CANCELLATION][WHATSAPP_SEND_FAILED]', {
        reservationId: reservation.idReserva,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return jsonResponse(request, {
    ok: true,
    cancelled: true,
  });
}
