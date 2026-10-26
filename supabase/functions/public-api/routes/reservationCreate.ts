import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { appendSheetValues, createGoogleAccessToken } from '../lib/googleSheets.ts';
import { normalizeDateKey, toStringValue } from '../lib/normalization.ts';
import {
  buildCreateReservationResult,
  isPublicRestaurantSlotWithinLeadTime,
  normalizeCreateReservationInput,
} from '../lib/reservations.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { resolveReservationStore } from '../../_shared/reservation-store/resolver.ts';
import { RestaurantRpcRejection } from '../../_shared/reservation-store/errors.ts';
import { isServiceOpenAt, isWeeklyService } from '../../_shared/booking-hours/weeklyHours.ts';
import { loadWeeklyHours } from '../../_shared/booking-hours/weeklyHoursAdapter.ts';
import type { CreateReservationCommand, ReservationStore } from '../../_shared/reservation-store/types.ts';

const DEFAULT_MAX_PUBLIC_RESTAURANT_PAX = 8;

interface ReservationCreateDependencies {
  now?: () => Date;
  createStore?: (...args: Parameters<typeof resolveReservationStore>) => Pick<ReservationStore, 'createReservation'>;
  weeklyCreateGuardEnabled?: boolean;
}

export function isWeeklyCreateGuardEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function getPublicReservationTimeError(
  request: Request,
  date: string,
  time: string,
  now = new Date(),
) {
  return isPublicRestaurantSlotWithinLeadTime(date, time, now)
    ? null
    : errorResponse(request, 'RESERVATION_TIME_PASSED', 409);
}

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

function expectedRpcResponse(request: Request, error: unknown, weeklyMode: boolean): Response | null {
  if (!(error instanceof RestaurantRpcRejection)) return null;
  switch (error.publicCode) {
    case 'RESERVATION_TIME_PASSED':
    case 'RESERVATION_OUTSIDE_WEEKLY_HOURS':
    case 'SERVICE_NOT_ENABLED':
    case 'BOOKINGS_DISABLED':
      return errorResponse(request, error.publicCode, 409);
    case 'WEEKLY_HOURS_CONFIG_INVALID':
    case 'WEEKLY_HOURS_CONFIG_READ_FAILED':
      return errorResponse(request, error.publicCode, 500);
    case 'AVAILABILITY_EXHAUSTED':
      return weeklyMode ? errorResponse(request, error.publicCode, 409) : null;
  }
}

export async function handleReservationCreate(request: Request, dbClient: DbClient, dependencies: ReservationCreateDependencies = {}) {
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

  let weeklyMode = false;
  if (dependencies.weeklyCreateGuardEnabled ?? isWeeklyCreateGuardEnabled(Deno.env.get('ENABLE_WEEKLY_CREATE_GUARD'))) {
    const weeklyHours = await loadWeeklyHours({
      readSettings: async () => {
        const query = await dbClient.from('SETTINGS').select('CLAVE,VALOR')
          .eq('CLIENTE_ID', context.clientId).in('CLAVE', ['WEEKLY_HOURS_ENABLED', 'SERVICES_ENABLED']);
        return { data: query.data, error: query.error };
      },
      readRules: async () => {
        const query = await dbClient.from('booking_service_hours').select('weekday,service,enabled,start_time,end_time')
          .eq('client_id', context.clientId);
        return { data: query.data, error: query.error };
      },
    }).catch(() => ({
      mode: 'error' as const,
      error: { code: 'WEEKLY_HOURS_CONFIG_READ_FAILED', message: 'Weekly hours configuration could not be read' },
    }));
    if (weeklyHours.mode === 'error') return errorResponse(request, weeklyHours.error.code, 500);
    if (weeklyHours.mode === 'weekly') {
      weeklyMode = true;
      const bookingsSetting = await (async () => {
        try {
          return await dbClient.from('SETTINGS').select('VALOR')
            .eq('CLIENTE_ID', context.clientId).eq('CLAVE', 'BOOKINGS_ENABLED').maybeSingle();
        } catch {
          return null;
        }
      })();
      if (!bookingsSetting || bookingsSetting.error) return errorResponse(request, 'WEEKLY_HOURS_CONFIG_READ_FAILED', 500);
      const bookingsRow = bookingsSetting.data as Record<string, unknown> | null;
      const bookingsValue = toStringValue(bookingsRow?.VALOR).toLowerCase();
      if (['false', '0', 'no', 'off', 'disabled'].includes(bookingsValue)) {
        return errorResponse(request, 'BOOKINGS_DISABLED', 409);
      }
      if (!isWeeklyService(normalized.servicio) || !weeklyHours.servicesEnabled?.has(normalized.servicio)) {
        return errorResponse(request, 'SERVICE_NOT_ENABLED', 409);
      }
      if (!isServiceOpenAt(weeklyHours.config, normalizeDateKey(normalized.fecha), normalized.servicio, normalized.hora)) {
        return errorResponse(request, 'RESERVATION_OUTSIDE_WEEKLY_HOURS', 409);
      }
    }
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
    const store = (dependencies.createStore ?? resolveReservationStore)({
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
    const timeError = getPublicReservationTimeError(request, result.normalized.fecha, result.normalized.hora, dependencies.now?.() ?? new Date());
    if (timeError) return timeError;
    await store.createReservation(command);
  } catch (error) {
    const expectedResponse = expectedRpcResponse(request, error, weeklyMode);
    if (expectedResponse) return expectedResponse;
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
