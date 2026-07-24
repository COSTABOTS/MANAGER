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
