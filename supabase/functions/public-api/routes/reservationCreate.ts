import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { appendSheetValues, createGoogleAccessToken } from '../lib/googleSheets.ts';
import {
  buildCreateReservationResult,
  normalizeCreateReservationInput,
} from '../lib/reservations.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { resolveReservationStore } from '../../_shared/reservation-store/resolver.ts';
import type { CreateReservationCommand } from '../../_shared/reservation-store/types.ts';

const DEFAULT_MAX_PUBLIC_RESTAURANT_PAX = 8;

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

  const { data: maxPaxSetting } = context.reservationStore === 'supabase'
    ? await dbClient.from('SETTINGS').select('VALOR').eq('CLIENTE_ID', context.clientId).eq('CLAVE', 'MAX_PAX_PER_BOOKING').maybeSingle()
    : { data: null };
  const configuredMaxPax = Number(String(maxPaxSetting?.VALOR ?? '').trim());
  const maxPublicRestaurantPax = Number.isInteger(configuredMaxPax) && configuredMaxPax > 0 ? configuredMaxPax : DEFAULT_MAX_PUBLIC_RESTAURANT_PAX;
  if (normalized.personas > maxPublicRestaurantPax) {
    return jsonResponse(request, {
      ok: false,
      code: 'MAX_PAX_EXCEEDED',
      message: normalized.idioma === 'EN'
        ? `For reservations of more than ${maxPublicRestaurantPax} people, please contact the restaurant directly.`
        : `Para reservas de más de ${maxPublicRestaurantPax} personas, contacta directamente con el restaurante.`,
    }, 400);
  }

  const usesSheets = (context.reservationStore ?? 'sheets').trim().toLowerCase() !== 'supabase';
  if (usesSheets && !context.sheetId) {
    return errorResponse(request, 'INVALID_CLIENT', 404);
  }

  const result = buildCreateReservationResult(normalized);
  const command: CreateReservationCommand = {
    id: result.idReserva,
    date: result.normalized.fecha,
    time: result.normalized.hora,
    name: result.normalized.nombre,
    phone: result.normalized.telefono,
    pax: result.normalized.personas,
    language: result.normalized.idioma,
    specialRequest: result.normalized.peticion,
    status: 'CONFIRMADA',
    origin: result.normalized.origen,
    table: '',
    arrived: false,
    feedbackSent: false,
    room: result.normalized.habitacion,
    service: result.normalized.servicio,
    balinesePackage: '',
    resource: '',
    createdAt: result.row[14],
    updatedAt: result.row[15],
  };

  try {
    const store = resolveReservationStore({
      clientId: context.clientId,
      sheetId: context.sheetId,
      reservationStore: context.reservationStore,
    }, {
      createReservation: async (reservation) => {
        const accessToken = await createGoogleAccessToken();
        await appendSheetValues(context.sheetId, 'RESERVAS!A:S', [result.row], accessToken);
        return { reservation };
      },
    }, dbClient);
    await store.createReservation(command);
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
