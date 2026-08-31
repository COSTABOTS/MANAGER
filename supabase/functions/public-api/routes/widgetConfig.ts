import type { DbClient } from '../lib/clients.ts';
import { validatePublicClient } from '../lib/clients.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { toStringValue } from '../lib/normalization.ts';

const ALLOWED_SERVICES = ['DESAYUNO', 'ALMUERZO', 'CENA', 'BALINESA'] as const;
const SERVICE_HOUR_KEYS = [
  'DESAYUNO_START', 'DESAYUNO_END',
  'ALMUERZO_START', 'ALMUERZO_END',
  'CENA_START', 'CENA_END',
] as const;

function normalizeServicesEnabled(value: unknown) {
  const services = toStringValue(value)
    .split(/[,\n;]/)
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is (typeof ALLOWED_SERVICES)[number] => ALLOWED_SERVICES.includes(item as (typeof ALLOWED_SERVICES)[number]));
  return [...new Set(services)].length > 0 ? [...new Set(services)] : ['CENA'];
}

function normalizeServiceHour(value: unknown) {
  const match = toStringValue(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? `${String(hours).padStart(2, '0')}:${match[2]}`
    : null;
}

export async function handleWidgetConfig(request: Request, dbClient: DbClient) {
  if (request.method !== 'GET') {
    return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
  }

  const url = new URL(request.url);
  const clientId = toStringValue(url.searchParams.get('client_id'));
  const publicToken = toStringValue(url.searchParams.get('public_token'));
  if (!clientId || !publicToken) {
    return errorResponse(request, 'INVALID_REQUEST', 400, {
      missing_fields: [
        ...(!clientId ? ['client_id'] : []),
        ...(!publicToken ? ['public_token'] : []),
      ],
    });
  }

  const context = await validatePublicClient(request, dbClient, { client_id: clientId, public_token: publicToken }, {
    missingFieldsError: 'INVALID_REQUEST',
    invalidClientError: 'INVALID_CLIENT',
    inactiveLicenseError: 'INVALID_CLIENT',
  });
  if ('error' in context) return context.error;

  const client = context.client;
  let services = ['CENA'];
  let maxPaxPerBooking = 8;
  const serviceHours: Record<string, { start: string | null; end: string | null }> = {
    DESAYUNO: { start: null, end: null },
    ALMUERZO: { start: null, end: null },
    CENA: { start: null, end: null },
  };
  if (context.reservationStore === 'supabase') {
    const { data: settings, error: settingsError } = await dbClient
      .from('SETTINGS')
      .select('CLAVE,VALOR')
      .eq('CLIENTE_ID', context.clientId)
      .in('CLAVE', ['SERVICES_ENABLED', 'MAX_PAX_PER_BOOKING', ...SERVICE_HOUR_KEYS]);
    if (settingsError) {
      console.warn('[PUBLIC_API][WIDGET_CONFIG][SETTINGS_READ_FAILED]', { clientId: context.clientId, code: settingsError.code });
    }
    const settingsMap = new Map((settings ?? []).map((row: Record<string, unknown>) => [toStringValue(row.CLAVE), row.VALOR]));
    services = normalizeServicesEnabled(settingsMap.get('SERVICES_ENABLED'));
    const configuredMaxPax = Number(toStringValue(settingsMap.get('MAX_PAX_PER_BOOKING')));
    if (Number.isInteger(configuredMaxPax) && configuredMaxPax > 0) maxPaxPerBooking = configuredMaxPax;
    serviceHours.DESAYUNO = { start: normalizeServiceHour(settingsMap.get('DESAYUNO_START')), end: normalizeServiceHour(settingsMap.get('DESAYUNO_END')) };
    serviceHours.ALMUERZO = { start: normalizeServiceHour(settingsMap.get('ALMUERZO_START')), end: normalizeServiceHour(settingsMap.get('ALMUERZO_END')) };
    serviceHours.CENA = { start: normalizeServiceHour(settingsMap.get('CENA_START')), end: normalizeServiceHour(settingsMap.get('CENA_END')) };
  }

  return jsonResponse(request, {
    ok: true,
    client_id: context.clientId,
    restaurant_name: toStringValue(client.rest_name),
    contact_phone: toStringValue(client.contact_phone) || null,
    services,
    max_pax_per_booking: maxPaxPerBooking,
    service_hours: serviceHours,
    branding: {
      logo_url: toStringValue(client.logo_url) || null,
      primary_color: toStringValue(client.primary_color) || null,
      header_image_url: toStringValue(client.header_image_url) || null,
      background_image_url: toStringValue(client.background_image_url) || null,
    },
  });
}
