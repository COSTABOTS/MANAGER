import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { appendSheetValues, createGoogleAccessToken, fetchSheetValues } from '../lib/googleSheets.ts';
import {
  type BalineseResource,
  buildBalineseReservationResult,
  findAvailableBalineseResource,
  getOccupiedBalineseResources,
  normalizeBalineseCreateInput,
  normalizeBalineseResources,
} from '../lib/balineseResources.ts';
import { normalizeService, toNumberValue, toStringValue } from '../lib/normalization.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { resolveReservationStore } from '../../_shared/reservation-store/resolver.ts';

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

function getSafeBalineseStoreFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toUpperCase();
  const category = normalized.includes('CAPACITY') ? 'CAPACITY'
    : normalized.includes('DAY_CLOSED') || normalized.includes('FULLY_BOOKED') ? 'DAY_CONTROL'
    : normalized.includes('BLOCK') ? 'BOOKING_BLOCK'
    : normalized.includes('SERVICE') ? 'SERVICE'
    : normalized.includes('RESOURCE') ? 'RESOURCE'
    : 'STORE_RPC';
  const knownCode = message.match(/^(SUPABASE_[A-Z0-9_]+)/)?.[1] ?? 'SUPABASE_RESERVATION_STORE_CREATE_FAILED';
  return { category, code: knownCode };
}

function getDebugPayload(
  body: Record<string, unknown>,
  normalized: { fecha: string; personas: number; servicio: string },
  resources: BalineseResource[],
  occupiedResources: Set<string>,
) {
  const resourcesWithCapacity = resources
    .filter((resource) => resource.capacidad <= 0 || resource.capacidad >= normalized.personas)
    .map((resource) => resource.recurso);
  const freeResources = resources
    .filter((resource) => !occupiedResources.has(resource.recurso.toUpperCase()))
    .map((resource) => resource.recurso);

  return {
    fecha_recibida: toStringValue(body.fecha ?? body.FECHA),
    fecha_normalizada: normalized.fecha,
    personas_recibidas: toNumberValue(body.personas ?? body.pax ?? body.PAX),
    servicio_normalizado: normalizeService(body.servicio ?? body.SERVICIO),
    recursos_activos: resources.map((resource) => resource.recurso),
    recursos_con_capacidad: resourcesWithCapacity,
    recursos_ocupados: Array.from(occupiedResources),
    recursos_libres: freeResources,
  };
}

export async function handleReservationBalineseCreate(request: Request, dbClient: DbClient) {
  if (request.method !== 'POST') {
    return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return errorResponse(request, 'INVALID_REQUEST', 400, { missing_fields: ['body'] });
  }

  const { normalized, missingFields, invalidFields } = normalizeBalineseCreateInput(body);
  if (invalidFields.includes('servicio')) {
    return errorResponse(request, 'INVALID_SERVICE', 400);
  }
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

  const usesSupabase = String(context.reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase';
  if (usesSupabase) {
    const { data: resourcesData, error: resourcesError } = await dbClient.from('reservable_resources').select('id,label,capacity,active').eq('client_id', context.clientId).eq('active', true).order('display_order', { ascending: true });
    if (resourcesError) return errorResponse(request, 'INTERNAL_ERROR', 500);
    const { data: reservationsData, error: reservationsError } = await dbClient.from('reservations').select('resource_id').eq('client_id', context.clientId).eq('booking_date', normalized.fecha).eq('service', 'BALINESA').not('status', 'in', '(cancelled,no_show)');
    if (reservationsError) return errorResponse(request, 'INTERNAL_ERROR', 500);
    const occupiedIds = new Set((reservationsData ?? []).map((row: Record<string, unknown>) => String(row.resource_id ?? '')).filter(Boolean));
    const resources = (resourcesData ?? []).map((row: Record<string, unknown>) => ({ recurso: String(row.label ?? ''), capacidad: Number(row.capacity ?? 0), id: String(row.id ?? '') }));
    const freeResources = resources.filter((resource) => !occupiedIds.has(resource.id));
    const resource = freeResources.find((item) => item.capacidad <= 0 || item.capacidad >= normalized.personas);
    if (!resource) return jsonResponse(request, { ok: false, code: freeResources.length ? 'NO_RESOURCE_WITH_CAPACITY' : 'NO_RESOURCE_AVAILABLE', error: freeResources.length ? 'NO_RESOURCE_WITH_CAPACITY' : 'NO_RESOURCE_AVAILABLE', available: false }, 409);
    const result = buildBalineseReservationResult(normalized, resource.recurso);
    try {
      const store = resolveReservationStore({ clientId: context.clientId, sheetId: '', reservationStore: context.reservationStore }, {}, dbClient);
      await store.createReservation({ id: result.idReserva, date: normalized.fecha, time: normalized.hora, name: normalized.nombre, phone: normalized.telefono, pax: normalized.personas, language: normalized.idioma, specialRequest: normalized.peticion, status: 'CONFIRMADA', origin: normalized.origen, table: '', arrived: false, feedbackSent: false, room: normalized.habitacion, service: 'BALINESA', balinesePackage: normalized.paquete, resource: resource.recurso });
    } catch (error) {
      const failure = getSafeBalineseStoreFailure(error);
      console.error('[PUBLIC_API][BALINESE_CREATE][SUPABASE_CREATE_FAILED]', {
        clientId: context.clientId,
        category: failure.category,
        code: failure.code,
      });
      return errorResponse(request, 'RESERVATION_CREATE_FAILED', 500);
    }
    return jsonResponse(request, { ok: true, reservation_created: true, id_reserva: result.idReserva, recurso: resource.recurso, reservation: { fecha: normalized.fecha, nombre: normalized.nombre, personas: normalized.personas, servicio: 'BALINESA', paquete_balinesa: normalized.paquete, recurso: resource.recurso, estado: 'CONFIRMADA' } }, 201);
  }
  if (!context.sheetId) {
    return errorResponse(request, 'INVALID_CLIENT', 404);
  }

  let accessToken = '';
  try {
    accessToken = await createGoogleAccessToken();
  } catch (error) {
    console.error('[PUBLIC_API][BALINESE_CREATE][GOOGLE_AUTH_FAILED]', {
      clientId: context.clientId,
      error: getSafeErrorCode(error),
    });
    return errorResponse(request, 'GOOGLE_AUTH_ERROR', 500);
  }

  let resourcesData: { values?: unknown[][] };
  let reservationsData: { values?: unknown[][] };
  try {
    [resourcesData, reservationsData] = await Promise.all([
      fetchSheetValues(context.sheetId, 'RECURSOS!A:F', accessToken),
      fetchSheetValues(context.sheetId, 'RESERVAS!A:Z', accessToken),
    ]);
  } catch (error) {
    console.error('[PUBLIC_API][BALINESE_CREATE][SHEETS_READ_FAILED]', {
      clientId: context.clientId,
      error: getSafeErrorCode(error),
    });
    return errorResponse(request, 'SHEETS_READ_FAILED', 502);
  }

  const resources = normalizeBalineseResources(resourcesData.values);
  const occupiedResources = getOccupiedBalineseResources(reservationsData.values, normalized.fecha);
  const shouldIncludeDebug = body.debug === true;
  let debugPayload = shouldIncludeDebug ? getDebugPayload(body, normalized, resources, occupiedResources) : undefined;
  let { resource, hasFreeResources } = findAvailableBalineseResource(resources, occupiedResources, normalized.personas);

  if (!resource) {
    const code = hasFreeResources ? 'NO_RESOURCE_WITH_CAPACITY' : 'NO_RESOURCE_AVAILABLE';
    return jsonResponse(request, {
      ok: false,
      code,
      error: code,
      message: code,
      available: false,
      ...(debugPayload ? { debug: debugPayload } : {}),
    }, 409);
  }

  try {
    const latestReservationsData = await fetchSheetValues(context.sheetId, 'RESERVAS!A:Z', accessToken);
    const latestOccupiedResources = getOccupiedBalineseResources(latestReservationsData.values, normalized.fecha);
    debugPayload = shouldIncludeDebug ? getDebugPayload(body, normalized, resources, latestOccupiedResources) : undefined;
    ({ resource, hasFreeResources } = findAvailableBalineseResource(resources, latestOccupiedResources, normalized.personas));
  } catch (error) {
    console.error('[PUBLIC_API][BALINESE_CREATE][FINAL_RECHECK_FAILED]', {
      clientId: context.clientId,
      error: getSafeErrorCode(error),
    });
    return errorResponse(request, 'SHEETS_READ_FAILED', 502);
  }

  if (!resource) {
    const code = hasFreeResources ? 'NO_RESOURCE_WITH_CAPACITY' : 'NO_RESOURCE_AVAILABLE';
    return jsonResponse(request, {
      ok: false,
      code,
      error: code,
      message: code,
      available: false,
      ...(debugPayload ? { debug: debugPayload } : {}),
    }, 409);
  }

  const result = buildBalineseReservationResult(normalized, resource.recurso);
  try {
    await appendSheetValues(context.sheetId, 'RESERVAS!A:T', [result.row], accessToken);
  } catch (error) {
    console.error('[PUBLIC_API][BALINESE_CREATE][APPEND_FAILED]', {
      clientId: context.clientId,
      reservationId: result.idReserva,
      error: getSafeErrorCode(error),
    });
    return errorResponse(request, 'RESERVATION_CREATE_FAILED', 500);
  }

  return jsonResponse(request, {
    ok: true,
    reservation_created: true,
    id_reserva: result.idReserva,
    recurso: resource.recurso,
    reservation: {
      fecha: normalized.fecha,
      nombre: normalized.nombre,
      personas: normalized.personas,
      servicio: 'BALINESA',
      paquete_balinesa: normalized.paquete,
      recurso: resource.recurso,
      estado: 'CONFIRMADA',
    },
    ...(debugPayload ? { debug: debugPayload } : {}),
  }, 201);
}
