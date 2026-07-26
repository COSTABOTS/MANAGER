import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { getPublicClientMessageData } from '../lib/clientPublicData.ts';
import { sendEvolutionText } from '../lib/evolution.ts';
import { createGoogleAccessToken, fetchSheetValues, updateSheetCell } from '../lib/googleSheets.ts';
import {
  normalizeDateKey,
  normalizeLanguage,
  normalizePhone,
  normalizeService,
  normalizeText,
  normalizeTime,
  pickValue,
  rowsToObjects,
  toNumberValue,
  toStringValue,
} from '../lib/normalization.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import {
  buildReservationCancellationUrl,
  buildReservationConfirmationMessage,
  maskReservationCancellationUrl,
} from '../templates/reservationConfirmation.ts';

type ReservationRow = {
  rowNumber: number;
  idReserva: string;
  fecha: string;
  hora: string;
  nombre: string;
  telefono: string;
  pax: string;
  idioma: string;
  peticionEspecial: string;
  estado: string;
  habitacion: string;
  servicio: string;
  paqueteBalinesa: string;
};

function getRequiredString(body: Record<string, unknown>, key: string) {
  return toStringValue(body[key]);
}

function normalizeReservationRows(values: unknown[][] | undefined): ReservationRow[] {
  return rowsToObjects(values).flatMap((item) => {
    const rowIndex = Number(item.__ROW_INDEX__);
    const idReserva = toStringValue(pickValue(item, ['ID_RESERVA', 'id_reserva', '0']));
    const fecha = toStringValue(pickValue(item, ['FECHA', 'fecha', '1']));
    const hora = toStringValue(pickValue(item, ['HORA', 'hora', '2']));
    const nombre = toStringValue(pickValue(item, ['NOMBRE', 'nombre', '3']));
    const telefono = toStringValue(pickValue(item, ['TELEFONO', 'telefono', '4']));
    const pax = toStringValue(pickValue(item, ['PAX', 'pax', '5']));
    const idioma = toStringValue(pickValue(item, ['IDIOMA', 'idioma', '6']));
    const peticionEspecial = toStringValue(pickValue(item, ['PETICION_ESPECIAL', 'PETICION ESPECIAL', 'peticionEspecial', '7']));
    const estado = toStringValue(pickValue(item, ['ESTADO', 'estado', '8'])).toUpperCase();
    const habitacion = toStringValue(pickValue(item, ['HABITACION', 'habitacion', '13']));
    const servicio = normalizeService(pickValue(item, ['SERVICIO', 'servicio', 'service', '16']));
    const paqueteBalinesa = toStringValue(pickValue(item, ['PAQUETE BALINESA', 'PAQUETE_BALINESA', 'paqueteBalinesa', 'paquete_balinesa', '17']));

    if (!idReserva || !fecha || !nombre) {
      return [];
    }

    return [{
      rowNumber: rowIndex + 1,
      idReserva,
      fecha,
      hora,
      nombre,
      telefono,
      pax,
      idioma,
      peticionEspecial,
      estado,
      habitacion,
      servicio,
      paqueteBalinesa,
    }];
  });
}

function findMatchingReservations(rows: ReservationRow[], body: Record<string, unknown>) {
  const targetName = normalizeText(body.nombre);
  const targetDate = normalizeDateKey(body.fecha);
  const targetService = normalizeService(body.servicio);
  const targetTime = normalizeTime(body.hora);

  return rows.filter((row) => {
    if (row.estado === 'CANCELADA') {
      return false;
    }

    const sameName = normalizeText(row.nombre) === targetName;
    const sameDate = normalizeDateKey(row.fecha) === targetDate;
    const sameService = normalizeService(row.servicio) === targetService;
    const sameTime = targetTime ? normalizeTime(row.hora) === targetTime : true;

    return sameName && sameDate && sameService && sameTime;
  });
}

function buildMessageData(row: ReservationRow, context: { clientId: string; client: Record<string, unknown> }, restaurantName: string) {
  return {
    idReserva: row.idReserva,
    nombre: row.nombre,
    fecha: row.fecha,
    hora: row.hora,
    personas: row.pax || String(toNumberValue(row.pax) || ''),
    servicio: row.servicio,
    paquete: row.paqueteBalinesa || 'BASIC',
    restaurantName,
    clientId: context.clientId,
    publicToken: toStringValue(context.client.public_token),
  };
}

export async function handleReservationSendConfirmation(request: Request, dbClient: DbClient) {
  if (request.method !== 'POST') {
    return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requiredFields = ['client_id', 'public_token', 'nombre', 'telefono', 'fecha', 'servicio', 'idioma'];
  const missingFields = requiredFields.filter((field) => !getRequiredString(body, field));

  if (missingFields.length > 0) {
    return errorResponse(request, 'INVALID_REQUEST', 400, { missing_fields: missingFields });
  }

  const language = normalizeLanguage(body.idioma);
  const phone = normalizePhone(body.telefono);
  if (!phone) {
    return errorResponse(request, 'INVALID_PHONE', 400);
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

  const accessToken = await createGoogleAccessToken();
  let sheetsData: { values?: unknown[][] };
  try {
    sheetsData = await fetchSheetValues(context.sheetId, 'RESERVAS!A:Z', accessToken);
  } catch (error) {
    console.error('[PUBLIC_API][SEND_CONFIRMATION][SHEETS_READ_FAILED]', {
      clientId: context.clientId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(request, 'SHEETS_READ_FAILED', 502);
  }

  const reservations = normalizeReservationRows(sheetsData.values);
  const matches = findMatchingReservations(reservations, body);

  if (matches.length === 0) {
    console.warn('[PUBLIC_API][SEND_CONFIRMATION][RESERVATION_NOT_FOUND]', {
      clientId: context.clientId,
      service: normalizeService(body.servicio),
      date: normalizeDateKey(body.fecha),
      hasTime: Boolean(normalizeTime(body.hora)),
    });
    return errorResponse(request, 'RESERVATION_NOT_FOUND', 404);
  }

  if (matches.length > 1) {
    console.warn('[PUBLIC_API][SEND_CONFIRMATION][AMBIGUOUS_RESERVATION]', {
      clientId: context.clientId,
      count: matches.length,
      reservationIds: matches.map((match) => match.idReserva),
    });
    return errorResponse(request, 'AMBIGUOUS_RESERVATION', 409);
  }

  const reservation = matches[0];
  try {
    await updateSheetCell(context.sheetId, `RESERVAS!E${reservation.rowNumber}`, phone, accessToken);
  } catch (error) {
    console.error('[PUBLIC_API][SEND_CONFIRMATION][PHONE_UPDATE_FAILED]', {
      clientId: context.clientId,
      reservationId: reservation.idReserva,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(request, 'PHONE_UPDATE_FAILED', 502);
  }

  const isBalinese = normalizeService(reservation.servicio) === 'BALINESA';
  const clientMessageData = getPublicClientMessageData(context.client, language);
  const messageData = buildMessageData(reservation, context, clientMessageData.restaurantName);
  const cancellationLink = buildReservationCancellationUrl(messageData, language);
  console.log('[PUBLIC_API][SEND_CONFIRMATION][CANCEL_LINK_CONTEXT]', {
    clientId: context.clientId,
    url: maskReservationCancellationUrl(cancellationLink),
    hasPublicToken: Boolean(messageData.publicToken),
  });
  const message = buildReservationConfirmationMessage(messageData, language, isBalinese);

  try {
    await sendEvolutionText(phone, message);
  } catch (error) {
    console.error('[PUBLIC_API][SEND_CONFIRMATION][WHATSAPP_SEND_FAILED]', {
      clientId: context.clientId,
      reservationId: reservation.idReserva,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(request, {
      ok: false,
      error: 'WHATSAPP_SEND_FAILED',
      phone_updated: true,
    }, 502);
  }

  return jsonResponse(request, {
    ok: true,
    reservation_id: reservation.idReserva,
    phone,
    language,
    message_type: isBalinese ? 'balinese' : 'restaurant',
  });
}
