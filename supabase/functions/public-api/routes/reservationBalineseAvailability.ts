import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { normalizeDateKey, toNumberValue, toStringValue } from '../lib/normalization.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';

export async function handleReservationBalineseAvailability(request: Request, dbClient: DbClient) {
  if (request.method !== 'POST') return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return errorResponse(request, 'INVALID_REQUEST', 400);
  const context = await validatePublicClient(request, dbClient, body, { missingFieldsError: 'INVALID_REQUEST', invalidClientError: 'INVALID_CLIENT' });
  if ('error' in context) return context.error;
  const date = normalizeDateKey(body.fecha ?? body.date);
  const pax = toNumberValue(body.personas ?? body.pax);
  if (!date || pax <= 0) return errorResponse(request, 'INVALID_REQUEST', 400);
  if (context.reservationStore !== 'supabase') {
    return errorResponse(request, 'BALINESE_AVAILABILITY_UNSUPPORTED', 501);
  }

  const resourcesResult = await dbClient.from('reservable_resources').select('id,capacity').eq('client_id', context.clientId).eq('active', true).eq('resource_type', 'balinese').order('display_order', { ascending: true });
  if (resourcesResult.error) return errorResponse(request, 'INTERNAL_ERROR', 500);
  const suitable = (resourcesResult.data ?? []).filter((row: Record<string, unknown>) => Number(row.capacity ?? 0) >= pax);
  if (suitable.length === 0) return jsonResponse(request, { available: false, available_count: 0, reason: 'NO_RESOURCE_WITH_CAPACITY' }, 200);

  const reservationsResult = await dbClient.from('reservations').select('resource_id,status,legacy_status').eq('client_id', context.clientId).eq('booking_date', date).eq('service', 'BALINESA');
  if (reservationsResult.error) return errorResponse(request, 'INTERNAL_ERROR', 500);
  const occupied = new Set((reservationsResult.data ?? []).filter((row: Record<string, unknown>) => {
    const status = toStringValue(row.status).toLowerCase();
    const legacy = toStringValue(row.legacy_status).toUpperCase();
    return !['cancelled', 'no_show'].includes(status) && !['CANCELADA', 'NO_SHOW'].includes(legacy);
  }).map((row: Record<string, unknown>) => toStringValue(row.resource_id)).filter(Boolean));
  const availableCount = suitable.filter((row: Record<string, unknown>) => !occupied.has(toStringValue(row.id))).length;
  return availableCount > 0
    ? jsonResponse(request, { available: true, available_count: availableCount }, 200)
    : jsonResponse(request, { available: false, available_count: 0, reason: 'NO_RESOURCE_AVAILABLE' }, 200);
}
