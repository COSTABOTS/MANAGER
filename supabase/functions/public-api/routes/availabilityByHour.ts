import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import {
  getAvailabilitySheetHeaderIssues,
  getAvailableHoursByCapacity,
  normalizeAvailabilityTime,
  normalizeCapacitySlots,
  normalizeReservationsForAvailability,
} from '../lib/availability.ts';
import { createGoogleAccessToken, fetchSheetValues } from '../lib/googleSheets.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { normalizeDateKey, toNumberValue, toStringValue } from '../lib/normalization.ts';

function pickBodyValue(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = body[key] ?? body[key.toUpperCase()] ?? body[key.toLowerCase()];
    if (value !== undefined && value !== null && toStringValue(value) !== '') {
      return value;
    }
  }

  return '';
}

function parseRequestedPax(value: unknown) {
  const raw = toStringValue(value);
  if (!/^\d+$/.test(raw)) {
    return 0;
  }

  return toNumberValue(raw);
}

export async function handleAvailabilityByHour(request: Request, dbClient: DbClient) {
  if (request.method !== 'POST') {
    return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return errorResponse(request, 'INVALID_REQUEST', 400, { missing_fields: ['body'] });
  }

  const fecha = normalizeDateKey(pickBodyValue(body, ['FECHA', 'fecha']));
  const horaSolicitada = normalizeAvailabilityTime(pickBodyValue(body, ['HORA', 'hora']));
  const paxInput = pickBodyValue(body, ['PAX', 'pax', 'paxSolicitados', 'personas']);
  const pax = parseRequestedPax(paxInput);
  const missingFields = [
    !toStringValue(body.client_id ?? body.clientId) ? 'client_id' : '',
    !toStringValue(body.public_token ?? body.publicToken) ? 'public_token' : '',
    !fecha ? 'fecha' : '',
    !toStringValue(paxInput) ? 'pax' : '',
  ].filter(Boolean);

  if (missingFields.length > 0) {
    return errorResponse(request, 'INVALID_REQUEST', 400, { missing_fields: missingFields });
  }

  if (pax <= 0) {
    return errorResponse(request, 'INVALID_REQUEST', 400, { invalid_fields: ['pax'] });
  }

  const context = await validatePublicClient(request, dbClient, body);
  if ('error' in context) {
    return context.error;
  }

  if (!context.sheetId) {
    return errorResponse(request, 'INVALID_CLIENT', 404);
  }

  try {
    const accessToken = await createGoogleAccessToken();
    const [capacityData, reservationsData] = await Promise.all([
      fetchSheetValues(context.sheetId, 'CAPACIDAD!A:C', accessToken),
      fetchSheetValues(context.sheetId, 'RESERVAS!A:Z', accessToken),
    ]);

    const headerIssues = getAvailabilitySheetHeaderIssues(capacityData.values, reservationsData.values);
    if (headerIssues.length > 0) {
      console.error('[PUBLIC_API][AVAILABILITY_BY_HOUR][MISSING_SHEET_HEADERS]', {
        clientId: context.clientId,
        issues: headerIssues,
      });
      return errorResponse(request, 'MISSING_SHEET_HEADERS', 500, { issues: headerIssues });
    }

    const result = getAvailableHoursByCapacity(
      normalizeCapacitySlots(capacityData.values),
      normalizeReservationsForAvailability(reservationsData.values),
      fecha,
      pax,
    );

    const disponible = Boolean(horaSolicitada) && result.horas_disponibles.includes(horaSolicitada);

    return jsonResponse(request, {
      ...result,
      DISPONIBLE: disponible,
      resultado: disponible ? 'TRUE' : 'FALSE',
    });
  } catch (error) {
    console.error('[PUBLIC_API][AVAILABILITY_BY_HOUR][INTERNAL_ERROR]', {
      clientId: context.clientId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(request, 'INTERNAL_ERROR', 500);
  }
}
