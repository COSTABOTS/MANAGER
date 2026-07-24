import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { appendSheetValues, createGoogleAccessToken } from '../lib/googleSheets.ts';
import {
  buildCreateReservationResult,
  normalizeCreateReservationInput,
} from '../lib/reservations.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';

function getSafeErrorCode(error: unknown) {
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

export async function handleReservationCreate(request: Request, dbClient: DbClient) {
  if (request.method !== 'POST') {
    return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return errorResponse(request, 'INVALID_REQUEST', 400, { missing_fields: ['body'] });
  }

  const { normalized, missingFields, invalidFields } = normalizeCreateReservationInput(body);
  if (missingFields.length > 0 || invalidFields.length > 0 || !normalized) {
    return errorResponse(request, 'INVALID_REQUEST', 400, {
      ...(missingFields.length > 0 ? { missing_fields: missingFields } : {}),
      ...(invalidFields.length > 0 ? { invalid_fields: invalidFields } : {}),
    });
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

  const result = buildCreateReservationResult(normalized);

  try {
    const accessToken = await createGoogleAccessToken();
    await appendSheetValues(context.sheetId, 'RESERVAS!A:S', [result.row], accessToken);
  } catch (error) {
    const errorCode = getSafeErrorCode(error);
    console.error('[PUBLIC_API][RESERVATION_CREATE][APPEND_FAILED]', {
      clientId: context.clientId,
      reservationId: result.idReserva,
      error: errorCode,
    });
    return errorResponse(request, 'RESERVATION_CREATE_FAILED', 500);
  }

  return jsonResponse(request, {
    ok: true,
    reservation_created: true,
    id_reserva: result.idReserva,
    reservation: {
      fecha: result.normalized.fecha,
      hora: result.normalized.hora,
      nombre: result.normalized.nombre,
      personas: result.normalized.personas,
      idioma: result.normalized.idioma,
      servicio: result.normalized.servicio,
      estado: 'CONFIRMADA',
      origen: result.normalized.origen,
    },
  }, 201);
}
