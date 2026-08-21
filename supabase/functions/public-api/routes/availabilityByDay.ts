import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { normalizeDateKey, toStringValue } from '../lib/normalization.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';

type DayControl = { service?: unknown; status?: unknown; fully_booked?: unknown };

export function evaluateDailyAvailability(
  controls: DayControl[],
  bookingsEnabled: boolean,
  service: string,
) {
  if (!bookingsEnabled) return { available: false, reason: 'bookings_disabled' as const };
  const normalizedService = toStringValue(service).toUpperCase();
  const applies = controls.filter((control) => {
    const controlService = toStringValue(control.service).toUpperCase();
    return !controlService || controlService === normalizedService;
  });
  if (applies.some((control) => control.fully_booked === true)) {
    return { available: false, reason: 'fully_booked' as const };
  }
  if (applies.some((control) => toStringValue(control.status).toLowerCase() === 'closed')) {
    return { available: false, reason: 'closed' as const };
  }
  return { available: true, reason: 'open' as const };
}

export async function handleAvailabilityByDay(request: Request, dbClient: DbClient) {
  if (request.method !== 'POST') return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return errorResponse(request, 'INVALID_REQUEST', 400);
  const context = await validatePublicClient(request, dbClient, body, {
    missingFieldsError: 'INVALID_REQUEST',
    invalidClientError: 'INVALID_CLIENT',
  });
  if ('error' in context) return context.error;
  const date = normalizeDateKey(body.fecha ?? body.FECHA);
  const service = toStringValue(body.servicio ?? body.SERVICIO ?? body.service) || 'CENA';
  if (!date) return errorResponse(request, 'INVALID_REQUEST', 400, { missing_fields: ['fecha'] });
  if (context.reservationStore !== 'supabase') {
    return errorResponse(request, 'AVAILABILITY_BY_DAY_UNSUPPORTED', 501);
  }

  const [controlsResult, settingsResult] = await Promise.all([
    dbClient.from('booking_day_controls')
      .select('service,status,fully_booked')
      .eq('client_id', context.clientId)
      .eq('booking_date', date),
    dbClient.from('SETTINGS').select('CLAVE,VALOR').eq('CLIENTE_ID', context.clientId).eq('CLAVE', 'BOOKINGS_ENABLED'),
  ]);
  if (controlsResult.error || settingsResult.error) {
    return errorResponse(request, 'AVAILABILITY_BY_DAY_FAILED', 500);
  }
  const settingsValue = toStringValue((settingsResult.data?.[0] as Record<string, unknown> | undefined)?.VALOR).toLowerCase();
  const bookingsEnabled = !settingsResult.data?.length || !['false', '0', 'no', 'off', 'disabled'].includes(settingsValue);
  const result = evaluateDailyAvailability((controlsResult.data ?? []) as DayControl[], bookingsEnabled, service);
  return jsonResponse(request, { ok: true, ...result });
}
