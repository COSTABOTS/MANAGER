import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, SetStateAction } from 'react';
import { Layout } from './components/Layout';
import { LoginScreen } from './components/LoginScreen';
import { BrandLogo } from './components/BrandLogo';
import { DEFAULT_COSTABOTS_LOGO } from './config/branding';
import { Control } from './pages/Control';
import { FeedbackPublic } from './pages/FeedbackPublic';
import { Feedbacks } from './pages/Feedbacks';
import { Reports } from './pages/Reports';
import { Reservations } from './pages/Reservations';
import { Settings } from './pages/Settings';
import { Shows } from './pages/Shows';
import { Today } from './pages/Today';
import { mockReservations, todayState } from './mock';
import { loadReservations as loadReservationsFromWebhook, loadReservationsFromManagerApi, normalizeReservationsFromSheets } from './services/api';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';
import {
  CLIENT_CONFIG_KEY,
  LOGIN_FLAG_KEY,
  getClientConfig,
  getClientSheetId,
  getClientWebhook,
  isValidClientConfig,
  normalizeClientConfig,
  populateAdminFromClientConfig,
} from './services/clientConfig';
import type { ExternalClientConfig } from './services/clientConfig';
import { clearDateBookingStatusStorage, loadDateBookingStatusFromStorage, saveDateBookingStatusToStorage } from './services/dateBookingStatusStorage';
import { loadFeedbacks as loadFeedbacksFromWebhook, loadFeedbacksFromManagerApi } from './services/feedbacks';
import type { Feedback } from './services/feedbacks';
import { loadFullyBookedFromManagerApi, saveFullyBookedWithManagerApi } from './services/fullyBooked';
import { loadCapacityFromManagerApi, loadCapacitySettings, saveCapacityWithManagerApi } from './services/capacitySettings';
import { applyOperationalDefaults, applyOperationalSettings, loadOperationalSettings, loadOperationalSettingsFromManagerApi, saveOperationalSettings, saveOperationalSettingsWithManagerApi } from './services/operationalSettings';
import { clearSettingsStorage, loadSettingsFromStorage, saveSettingsToStorage } from './services/settingsStorage';
import { loadRestaurantTables, loadTablesFromSupabaseEdge, saveRestaurantTable, saveRestaurantTableWithManagerApi } from './services/tables';
import { sendWebhook } from './services/webhookClient';
import { requireNameOrRoom, requireWebhookFields } from './services/webhookValidation';
import { assignTableWithManagerApi, cancelReservationWithManagerApi, createManualReservationWithManagerApi, createWalkInWithManagerApi, saveArrivalWithManagerApi, setBalinesePaymentWithManagerApi } from './services/reservations';
import { loadResourcesWithManagerApi, saveResourceWithManagerApi } from './services/resources';
import { saveClientLicenseWithManagerApi } from './services/clientLicense';
import { saveClientBrandingWithManagerApi } from './services/clientBranding';
import { loadManagedClientsWithManagerApi } from './services/clients';
import type { BookingService, BookingStatus, ClientLicense, ClientLicensePlan, ClientLicenseStatus, DateBookingStatus, DateBookingStatusValue, DayState, ManagerSettings, ReservableResource, Reservation, RestaurantTable, WalkInPayload } from './types';
import { buildCapacityPayload, generateTimeSlots } from './utils/capacity';
import { getCurrentTime, getLocalDateString, normalizeDateForCompare } from './utils/date';
import { createReservationId } from './utils/reservationId';
import { isActiveReservation } from './utils/reservationStatus';

export type PageKey = 'today' | 'reservations' | 'control' | 'reports' | 'feedbacks' | 'shows' | 'settings';

const LOGIN_WEBHOOK_URL = 'https://hook.eu1.make.com/nt1tpv599c07vq26u107ddgbsnjdpook';
const SETTINGS_WEBHOOK_FALLBACK = '';
const DEMO_EMAIL = 'demo@costabots.local';
const DEMO_PASSWORD = 'Demo2026';
const PROTECTED_DEMO_EMAIL = 'demo2@costabots.local';
const USE_MANAGER_API = import.meta.env.VITE_USE_MANAGER_API === 'true';
const TODAY_TAB_SERVICES: BookingService[] = ['DESAYUNO', 'ALMUERZO', 'CENA', 'BALINESA'];
const TIMED_SERVICE_ORDER: Array<'DESAYUNO' | 'ALMUERZO' | 'CENA'> = ['DESAYUNO', 'ALMUERZO', 'CENA'];
const CLIENT_PRIMARY_FALLBACK = '#3b63a3';
const DEFAULT_SERVICE_HOURS: ManagerSettings['serviceHours'] = {
  DESAYUNO: { start: '08:00', end: '10:30' },
  ALMUERZO: { start: '12:00', end: '16:00' },
  CENA: { start: '18:00', end: '21:30' },
};

console.log('[App loaded]', window.location.pathname);

function normalizeBookingService(value: unknown): BookingService {
  const service = String(value ?? '')
    .trim()
    .replace(/^[\s"'[\]]+|[\s"'[\]]+$/g, '')
    .toUpperCase();
  if (service === 'DESAYUNO' || service === 'ALMUERZO' || service === 'BALINESA') {
    return service;
  }

  return 'CENA';
}

function normalizeEnabledServices(services: unknown): BookingService[] {
  const source = Array.isArray(services)
    ? services
    : String(services ?? '')
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean);
  const normalized = source.map(normalizeBookingService);
  const uniqueServices = normalized.filter((service, index) => normalized.indexOf(service) === index);

  return uniqueServices.length > 0 ? uniqueServices : ['CENA'];
}

function getTodayTabServices(services: BookingService[]): BookingService[] {
  const visibleServices = TODAY_TAB_SERVICES.filter((service) => services.includes(service));
  return visibleServices.length > 0 ? visibleServices : ['CENA'];
}

function getServiceForCurrentHour(): Exclude<BookingService, 'BALINESA'> {
  const hour = new Date().getHours();

  if (hour >= 6 && hour <= 10) {
    return 'DESAYUNO';
  }

  if (hour >= 11 && hour <= 17) {
    return 'ALMUERZO';
  }

  return 'CENA';
}

function getInitialTodayService(serviceTabs: BookingService[]): BookingService {
  const timedService = getServiceForCurrentHour();

  if (serviceTabs.includes(timedService)) {
    return timedService;
  }

  if (serviceTabs.includes('CENA')) {
    return 'CENA';
  }

  return serviceTabs.find((service) => service !== 'BALINESA') ?? serviceTabs[0] ?? 'CENA';
}

function normalizeUserRole(role: unknown) {
  return String(role ?? '').trim().toUpperCase();
}

function normalizeHexColor(value: unknown) {
  const rawColor = String(value ?? '').trim();
  const match = rawColor.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);

  if (!match) {
    return CLIENT_PRIMARY_FALLBACK;
  }

  const hex = match[1].length === 3
    ? match[1].split('').map((char) => `${char}${char}`).join('')
    : match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  if (luminance > 0.82) {
    return CLIENT_PRIMARY_FALLBACK;
  }

  return `#${hex.toLowerCase()}`;
}

function mixColor(hexColor: string, ratio: number) {
  const hex = normalizeHexColor(hexColor).slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

  return `#${clamp(red * ratio).toString(16).padStart(2, '0')}${clamp(green * ratio).toString(16).padStart(2, '0')}${clamp(blue * ratio).toString(16).padStart(2, '0')}`;
}

function hexToRgb(hexColor: string) {
  const hex = normalizeHexColor(hexColor).slice(1);
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

interface ManagedClientOption {
  client_id: string;
  rest_name: string;
  logo_url?: string;
  primary_color?: string;
  sheet_id?: string;
  is_demo?: boolean;
  status?: string;
  plan?: string;
  expires_at?: string;
}

function mapManagedClient(row: Record<string, unknown>): ManagedClientOption {
  return {
    client_id: pickSupabaseValue(row, ['client_id', 'CLIENT_ID']),
    rest_name: pickSupabaseValue(row, ['rest_name', 'REST_NAME', 'rest_nombre', 'restaurantName', 'restaurant_name']),
    logo_url: pickSupabaseValue(row, ['logo_url', 'LOGO_URL', 'logo_restaurante', 'restaurantLogoUrl']),
    primary_color: pickSupabaseValue(row, ['primary_color', 'PRIMARY_COLOR', 'color', 'primaryColor']),
    sheet_id: pickSupabaseValue(row, ['sheet_id', 'SHEET_ID', 'googleSheetId']),
    is_demo: toSupabaseBoolean(row.is_demo ?? row.IS_DEMO),
    status: pickSupabaseValue(row, ['status', 'STATUS']) || 'ACTIVE',
    plan: pickSupabaseValue(row, ['plan', 'PLAN']) || 'DEMO',
    expires_at: pickSupabaseValue(row, ['expires_at', 'EXPIRES_AT', 'expiresAt']),
  };
}

function normalizeClientLicenseStatus(value: unknown): ClientLicenseStatus {
  const status = String(value ?? '').trim().toUpperCase();
  return status === 'TRIAL' || status === 'SUSPENDED' || status === 'EXPIRED' ? status : 'ACTIVE';
}

function normalizeClientLicensePlan(value: unknown): ClientLicensePlan {
  const plan = String(value ?? '').trim().toUpperCase();
  return plan === 'PRO' ? 'PRO' : 'DEMO';
}

function getClientLicenseFromConfig(config: ExternalClientConfig | null): ClientLicense {
  const selectedClient = config?.selectedClient as Record<string, unknown> | undefined;
  return {
    status: normalizeClientLicenseStatus(config?.licenseStatus ?? config?.status ?? selectedClient?.status),
    plan: normalizeClientLicensePlan(config?.licensePlan ?? config?.plan ?? selectedClient?.plan),
    expiresAt: pickSupabaseValue(
      {
        expires_at: config?.expires_at,
        licenseExpiresAt: config?.licenseExpiresAt,
        selectedExpiresAt: selectedClient?.expires_at,
      },
      ['licenseExpiresAt', 'expires_at', 'selectedExpiresAt'],
    ),
  };
}

function isInactiveClientLicense(license: ClientLicense) {
  return license.status === 'SUSPENDED' || license.status === 'EXPIRED';
}

function timeToMinutes(time: unknown) {
  const rawTime = String(time ?? '').trim();
  const match = rawTime.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function isTimeInRange(time: string, start: string, end: string) {
  const current = timeToMinutes(time);
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);

  if (current === null || startMinutes === null || endMinutes === null) {
    return false;
  }

  if (startMinutes <= endMinutes) {
    return current >= startMinutes && current <= endMinutes;
  }

  return current >= startMinutes || current <= endMinutes;
}

function getWalkInServiceForTime(time: string, settings: ManagerSettings): BookingService {
  const enabledServices = normalizeEnabledServices(settings.servicesEnabled);
  const currentMinutes = timeToMinutes(time);
  const candidates: Array<{ service: 'DESAYUNO' | 'ALMUERZO' | 'CENA'; distance: number; isNext: boolean; order: number }> = [];

  for (const [order, service] of TIMED_SERVICE_ORDER.entries()) {
    if (!enabledServices.includes(service)) {
      continue;
    }

    const serviceHours = settings.serviceHours?.[service] ?? DEFAULT_SERVICE_HOURS[service];
    if (serviceHours && isTimeInRange(time, serviceHours.start, serviceHours.end)) {
      return service;
    }
    const start = timeToMinutes(serviceHours?.start);
    const end = timeToMinutes(serviceHours?.end);
    if (currentMinutes !== null && start !== null && end !== null && start <= end) {
      const isNext = currentMinutes < start;
      candidates.push({ service, distance: isNext ? start - currentMinutes : currentMinutes - end, isNext, order });
    }
  }

  const nearest = candidates.sort((a, b) => a.distance - b.distance || Number(b.isNext) - Number(a.isNext) || a.order - b.order)[0];
  return nearest?.service ?? enabledServices.find((service) => TIMED_SERVICE_ORDER.includes(service as typeof TIMED_SERVICE_ORDER[number])) ?? 'CENA';
}

function clearLoginSession() {
  sessionStorage.removeItem(LOGIN_FLAG_KEY);
  sessionStorage.removeItem(CLIENT_CONFIG_KEY);
  clearSettingsStorage();
  clearDateBookingStatusStorage();
}

function loadClientConfigFromSession() {
  try {
    const isLoggedIn = sessionStorage.getItem(LOGIN_FLAG_KEY) === 'true';
    const config = getClientConfig();

    if (!isLoggedIn || !isValidClientConfig(config)) {
      clearLoginSession();
      return null;
    }

    return config;
  } catch {
    clearLoginSession();
    return null;
  }
}

function pickSupabaseValue(row: Record<string, unknown> | null | undefined, keys: string[]) {
  const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedEntries = Object.entries(row ?? {}).reduce<Record<string, unknown>>((items, [key, value]) => {
    items[normalizeKey(key)] = value;
    return items;
  }, {});

  for (const key of keys) {
    const value = row?.[key] ?? row?.[key.toLowerCase()] ?? row?.[key.toUpperCase()] ?? normalizedEntries[normalizeKey(key)];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
}

function toSupabaseBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'yes', 'si', 'sí', 'active'].includes(String(value ?? '').trim().toLowerCase());
}

function normalizeDemoWebhooks(rows: Array<Record<string, unknown>>) {
  const webhooks = rows.reduce<Record<string, string>>((items, row) => {
    if (!toSupabaseBoolean(row.activo ?? row.ACTIVO ?? row.active)) {
      return items;
    }

    const action = pickSupabaseValue(row, ['tipo_accion', 'TIPO_ACCION', 'action']);
    const url = pickSupabaseValue(row, ['url_webhook', 'URL_WEBHOOK', 'url']);

    if (action && url) {
      items[action] = url;
    }

    return items;
  }, {});

  [
    'RESERVATION_CREATE',
    'RESERVATION_LIST',
    'RESERVATION_CANCEL',
    'WALKIN_CREATE',
    'ARRIVAL_UPDATE',
    'TABLE_ASSIGN',
    'FULLY_BOOKED',
    'TABLES_LIST',
    'TABLE_SAVE',
    'CAPACITY_LIST',
    'CAPACITY_SAVE',
    'SHOWS_UPDATE',
    'FEEDBACK_CREATE',
    'SETTINGS_UPDATE',
  ].forEach((key) => {
    if (!webhooks[key]) {
      console.warn('[DEMO] Missing webhook:', key);
    }
  });

  return webhooks;
}

function normalizeDemoSettings(rows: Array<Record<string, unknown>>) {
  return rows.reduce<Record<string, unknown>>((items, row) => {
    const key = pickSupabaseValue(row, ['variable', 'VARIABLE', 'key', 'name']);
    const value = row.value ?? row.VALUE ?? row.valor ?? row.VALOR ?? '';

    if (key) {
      items[key] = value;
    }

    return items;
  }, {});
}

function pickDemoReservationValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return '';
}

function toDemoString(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function toDemoNumber(value: unknown) {
  const numberValue = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function toDemoBoolean(value: unknown) {
  return ['true', '1', 'yes', 'si', 'sí'].includes(String(value ?? '').trim().toLowerCase());
}

function normalizeDemoStatus(value: unknown): BookingStatus {
  const status = toDemoString(value).toUpperCase();
  if (['CANCELADA', 'CANCELADO', 'CANCELLED', 'CANCELED'].includes(status)) {
    return 'CANCELADA';
  }

  return 'CONFIRMADA';
}

function normalizeDemoSource(value: unknown): Reservation['source'] {
  const source = toDemoString(value).toUpperCase();
  if (source === 'WALK-IN' || source === 'WALKIN') {
    return 'WALKIN';
  }
  if (source === 'MANUAL') {
    return 'MANUAL';
  }
  if (source === 'WEB') {
    return 'WEB';
  }
  if (source === 'HOTEL') {
    return 'HOTEL';
  }
  if (source === 'LANDBOT') {
    return 'LANDbot';
  }

  return 'BOT';
}

function normalizeDemoService(value: unknown): BookingService {
  const service = toDemoString(value).toUpperCase();
  if (service === 'DESAYUNO' || service === 'ALMUERZO' || service === 'BALINESA') {
    return service;
  }

  return 'CENA';
}

function normalizeDemoReservations(rows: Array<Record<string, unknown>>): Reservation[] {
  return rows.flatMap((row) => {
    const idReserva = toDemoString(row.id ?? row.ID_RESERVA ?? pickDemoReservationValue(row, [
      'idReserva',
      'id_reserva',
      'ID_RESERVA',
      'publicReference',
      'public_reference',
      '0',
    ]));
    if (!idReserva) {
      console.warn('[DEMO] Reserva sin ID_RESERVA', row);
      return [];
    }

    return [{
      id: idReserva,
      idReserva,
      date: toDemoString(pickDemoReservationValue(row, ['date', 'fecha', 'FECHA', '1'])),
      time: toDemoString(pickDemoReservationValue(row, ['time', 'hora', 'HORA', '2'])),
      name: toDemoString(pickDemoReservationValue(row, ['name', 'nombre', 'NOMBRE', '3'])),
      phone: toDemoString(pickDemoReservationValue(row, ['phone', 'telefono', 'TELEFONO', '4'])),
      pax: toDemoNumber(pickDemoReservationValue(row, ['pax', 'PAX', '5'])),
      language: toDemoString(pickDemoReservationValue(row, ['language', 'idioma', 'IDIOMA', '6'])),
      specialRequest: toDemoString(pickDemoReservationValue(row, ['specialRequest', 'peticionEspecial', 'PETICION_ESPECIAL', '7'])),
      status: normalizeDemoStatus(pickDemoReservationValue(row, ['status', 'estado', 'ESTADO', '8'])),
      source: normalizeDemoSource(pickDemoReservationValue(row, ['sourceChannel', 'source', 'origen', 'ORIGEN', '9'])),
      table: toDemoString(pickDemoReservationValue(row, ['table', 'mesa', 'MESA', '10'])),
      arrived: toDemoBoolean(pickDemoReservationValue(row, ['arrived', 'llego', 'LLEGO', '11'])),
      room: toDemoString(pickDemoReservationValue(row, ['room', 'habitacion', 'HABITACION', '12'])),
      service: normalizeDemoService(pickDemoReservationValue(row, ['servicio', 'SERVICIO', 'service', '16'])),
      balinesePackage: toDemoString(pickDemoReservationValue(row, ['balinesePackage', 'balinese_package', 'paqueteBalinesa', 'PAQUETE_BALINESA', 'PAQUETE BALINESA', '17'])),
      resource: toDemoString(pickDemoReservationValue(row, ['recurso', 'RECURSO', 'resource', '18'])),
      balinesePaid: toDemoBoolean(pickDemoReservationValue(row, ['balinesePaid', 'balinese_paid'])),
    }];
  });
}

async function loadSupabaseClientConfig(userId: string, selectedClientId?: string) {
  console.log('[LOGIN][SUPABASE] user id', userId);
  const profileResult = await supabase
    .from('PROFILES')
    .select('user_id, client_id, role, status')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileResult.error) {
    throw new Error(`PROFILE_ERROR: ${profileResult.error.message}`);
  }

  const profile = profileResult.data as Record<string, unknown> | null;
  if (!profile) {
    throw new Error('PROFILE_NOT_FOUND');
  }
  console.log('[LOGIN][SUPABASE] profile found', profile);

  const profileStatus = pickSupabaseValue(profile, ['status', 'STATUS']).toUpperCase();
  if (profileStatus !== 'ACTIVE') {
    throw new Error('PROFILE_INACTIVE');
  }

  const profileClientId = pickSupabaseValue(profile, ['client_id', 'CLIENT_ID']).trim();
  if (!profileClientId) {
    throw new Error('CLIENT_ID_NOT_FOUND');
  }

  const profileRole = normalizeUserRole(pickSupabaseValue(profile, ['role', 'ROLE']));
  let availableClients: ManagedClientOption[] = [];
  let clientId = profileClientId;
  let clientFromManagedList: ManagedClientOption | null = null;

  if (profileRole === 'SUPER_ADMIN') {
    try {
      availableClients = (await loadManagedClientsWithManagerApi())
        .map((client) => mapManagedClient(client as unknown as Record<string, unknown>))
        .filter((client) => client.client_id);
    } catch (managerApiError) {
      console.warn('[LOGIN][SUPABASE] manager-api clients.list warning', managerApiError);
      const clientsResult = await supabase
        .from('CLIENTES')
        .select('*');

      if (clientsResult.error) {
        console.warn('[LOGIN][SUPABASE] clients list warning', clientsResult.error);
      } else {
        availableClients = ((clientsResult.data ?? []) as Array<Record<string, unknown>>)
          .map(mapManagedClient)
          .filter((client) => client.client_id);
      }
    }

    const requestedClient = selectedClientId
      ? availableClients.find((client) => client.client_id === selectedClientId)
      : null;
    const defaultClient = availableClients.find((client) => client.client_id !== 'COSTABOTS_CORE') ?? availableClients[0];
    clientFromManagedList = requestedClient ?? defaultClient ?? null;
    clientId = clientFromManagedList?.client_id ?? profileClientId;
  }

  let client: Record<string, unknown> | null = clientFromManagedList as unknown as Record<string, unknown> | null;
  if (!client) {
    const clientResult = await supabase
      .from('CLIENTES')
      .select('*')
      .eq('client_id', clientId)
      .maybeSingle();

    if (clientResult.error) {
      throw new Error(`CLIENT_ERROR: ${clientResult.error.message}`);
    }

    client = clientResult.data as Record<string, unknown> | null;
  }
  if (!client) {
    throw new Error('CLIENT_NOT_FOUND');
  }
  console.log('[LOGIN][SUPABASE] client found', client);

  const webhooksResult = await supabase.from('WEBHOOKS').select('*');
  if (webhooksResult.error) {
    console.warn('[MANAGER_API] Webhooks load warning:', webhooksResult.error);
  }

  const globalWebhooks = (webhooksResult.data ?? []).reduce<Record<string, string>>((items, row: Record<string, unknown>) => {
    const active = row.ACTIVO ?? row.activo;
    const action = row.TIPO_ACCION ?? row.tipo_accion;
    const url = row.URL_WEBHOOK ?? row.url_webhook;
    if ((active === true || active === 'true' || active === 'TRUE') && action && url) {
      items[String(action)] = String(url);
    }
    return items;
  }, {});

  let operationalSettings: Record<string, unknown> = {};
  const settingsResult = await supabase.from('SETTINGS').select('*').eq('client_id', clientId);
  if (settingsResult.error) {
    console.warn('[MANAGER_API] Settings load warning:', settingsResult.error);
  } else {
    operationalSettings = normalizeDemoSettings((settingsResult.data ?? []) as Array<Record<string, unknown>>);
  }

  const webhooks: Record<string, string> = {
    ...globalWebhooks,
    getReservas: globalWebhooks.RESERVATION_LIST || '',
    reservas: globalWebhooks.RESERVATION_CREATE || '',
    getMesas: globalWebhooks.TABLES_LIST || '',
    saveMesa: globalWebhooks.TABLE_SAVE || '',
    getFeedbacks: globalWebhooks.FEEDBACK_LIST || globalWebhooks.FEEDBACK_CREATE || '',
    feedbacks: globalWebhooks.FEEDBACK_CREATE || '',
    settings: globalWebhooks.SETTINGS_UPDATE || '',
    getCapacidad: globalWebhooks.CAPACITY_LIST || '',
    saveCapacidad: globalWebhooks.CAPACITY_SAVE || '',
  };

  const restaurantName = pickSupabaseValue(client, ['rest_name', 'REST_NAME', 'rest_nombre', 'restaurantName', 'restaurant_name']);
  const restaurantLogo = pickSupabaseValue(client, ['logo_url', 'LOGO_URL', 'logo_restaurante', 'restaurantLogoUrl']);
  const primaryColor = pickSupabaseValue(client, ['primary_color', 'PRIMARY_COLOR', 'color', 'primaryColor']);
  const sheetId = pickSupabaseValue(client, ['sheet_id', 'SHEET_ID', 'googleSheetId']);
  const licenseStatus = normalizeClientLicenseStatus(pickSupabaseValue(client, ['status', 'STATUS']));
  const licensePlan = normalizeClientLicensePlan(pickSupabaseValue(client, ['plan', 'PLAN']));
  const licenseExpiresAt = pickSupabaseValue(client, ['expires_at', 'EXPIRES_AT', 'expiresAt']);
  const selectedClient = mapManagedClient(client);
  console.log('[SUPER_ADMIN][CLIENT_CONTEXT]', {
    authProfileClientId: profileClientId,
    selectedClientId: selectedClient.client_id,
    effectiveClientId: clientId,
    role: profileRole,
  });

  const config = normalizeClientConfig({
    success: true,
    auth_provider: 'supabase',
    client_id: clientId,
    clientId,
    rest_nombre: restaurantName,
    rest_name: restaurantName,
    restaurantName,
    logo_restaurante: restaurantLogo,
    logo_url: restaurantLogo,
    restaurantLogoUrl: restaurantLogo,
    color: primaryColor,
    primary_color: primaryColor,
    primaryColor,
    sheet_id: sheetId,
    googleSheetId: sheetId,
    role: profileRole,
    status: licenseStatus,
    plan: licensePlan,
    expires_at: licenseExpiresAt,
    licenseStatus,
    licensePlan,
    licenseExpiresAt,
    profile_client_id: profileClientId,
    authProfileClientId: profileClientId,
    selectedClient,
    selectedClientId: selectedClient.client_id,
    effectiveClientId: clientId,
    availableClients,
    IS_DEMO: toSupabaseBoolean(client.is_demo ?? client.IS_DEMO),
    is_demo: toSupabaseBoolean(client.is_demo ?? client.IS_DEMO),
    settings: operationalSettings,
    webhooks,
    webhooksLegacy: {
      getReservas: webhooks.RESERVATION_LIST || '',
      reservas: webhooks.RESERVATION_CREATE || '',
      getMesas: webhooks.TABLES_LIST || '',
      saveMesa: webhooks.TABLE_SAVE || '',
      getFeedbacks: webhooks.FEEDBACK_LIST || webhooks.FEEDBACK_CREATE || '',
      feedbacks: webhooks.FEEDBACK_CREATE || '',
      settings: webhooks.SETTINGS_UPDATE || '',
      getCapacidad: webhooks.CAPACITY_LIST || '',
      saveCapacidad: webhooks.CAPACITY_SAVE || '',
    },
    webhookReservas: webhooks.RESERVATION_CREATE,
    webhook_reservas: webhooks.RESERVATION_CREATE || '',
    webhook_manual: webhooks.RESERVATION_CREATE,
    webhookLeerReservas: webhooks.RESERVATION_LIST,
    webhook_get_reservas: webhooks.RESERVATION_LIST,
    webhookCancelarReserva: webhooks.RESERVATION_CANCEL,
    webhookCancelReservationUrl: webhooks.RESERVATION_CANCEL,
    webhook_cancel: webhooks.RESERVATION_CANCEL,
    webhookWalkin: webhooks.WALKIN_CREATE,
    webhook_walkin: webhooks.WALKIN_CREATE,
    webhookLlegada: webhooks.ARRIVAL_UPDATE,
    webhook_arrived: webhooks.ARRIVAL_UPDATE,
    webhookMesa: webhooks.TABLE_ASSIGN,
    webhook_mesa: webhooks.TABLE_ASSIGN,
    webhookFullyBooked: webhooks.FULLY_BOOKED,
    webhook_fully_booked: webhooks.FULLY_BOOKED,
    webhookLeerMesas: webhooks.TABLES_LIST,
    webhookGetMesas: webhooks.TABLES_LIST,
    webhook_get_mesas: webhooks.TABLES_LIST,
    webhookGuardarMesa: webhooks.TABLE_SAVE,
    webhookSaveMesa: webhooks.TABLE_SAVE,
    webhook_save_mesa: webhooks.TABLE_SAVE,
    webhookLeerCapacidad: webhooks.CAPACITY_LIST,
    webhookGetCapacidad: webhooks.CAPACITY_LIST,
    webhook_get_capacidad: webhooks.CAPACITY_LIST,
    webhookGuardarCapacidad: webhooks.CAPACITY_SAVE,
    webhookSettingsCapacityUrl: webhooks.CAPACITY_SAVE,
    webhook_capacidad: webhooks.CAPACITY_SAVE,
    webhookShows: webhooks.SHOWS_UPDATE,
    webhook_shows: webhooks.SHOWS_UPDATE,
    webhookFeedbacks: webhooks.FEEDBACK_LIST || webhooks.FEEDBACK_CREATE,
    webhook_feedbacks: webhooks.FEEDBACK_LIST || webhooks.FEEDBACK_CREATE,
    webhookSettings: webhooks.SETTINGS_UPDATE,
    webhook_settings: webhooks.SETTINGS_UPDATE,
  });

  console.log('[LOGIN][SUPABASE] final config', config);
  console.log('[MANAGER_API] Client config loaded', config.client_id, config.rest_nombre);
  return config;
}

interface ManagerAppProps {
  onLogoutComplete?: () => void;
}

function ManagerApp({ onLogoutComplete }: ManagerAppProps = {}) {
  const [activePage, setActivePage] = useState<PageKey>('today');
  const [clientConfig, setClientConfig] = useState<ExternalClientConfig | null>(() => loadClientConfigFromSession());
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [allReservations, setAllReservations] = useState<Reservation[]>(() => (clientConfig ? [] : mockReservations));
  const [dayStatus, setDayStatus] = useState<DayState>({
    ...todayState,
    date: getLocalDateString(new Date()),
  });
  const [settings, setSettings] = useState<ManagerSettings>(() => {
    const storedSettings = loadSettingsFromStorage();
    const sessionConfig = loadClientConfigFromSession();
    return sessionConfig ? populateAdminFromClientConfig(storedSettings, sessionConfig) : storedSettings;
  });
  const [dateBookingStatus, setDateBookingStatus] = useState<DateBookingStatus>(() => (clientConfig ? {} : loadDateBookingStatusFromStorage()));
  const fullyBookedGenerationRef = useRef<Record<string, number>>({});
  const [lastSync, setLastSync] = useState('Datos mock cargados');
  const [isLoadingReservations, setIsLoadingReservations] = useState(false);
  const isLoadingReservationsRef = useRef(false);
  const [restaurantTables, setRestaurantTables] = useState<RestaurantTable[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [tablesSyncMessage, setTablesSyncMessage] = useState('');
  const [reservableResources, setReservableResources] = useState<ReservableResource[]>([]);
  const [isLoadingResources, setIsLoadingResources] = useState(false);
  const [resourcesSyncMessage, setResourcesSyncMessage] = useState('');
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isLoadingFeedbacks, setIsLoadingFeedbacks] = useState(false);
  const [feedbacksMessage, setFeedbacksMessage] = useState('');
  const [feedbacksLoaded, setFeedbacksLoaded] = useState(false);
  const [hasLoadedReservations, setHasLoadedReservations] = useState(false);
  const [hasLoadedTables, setHasLoadedTables] = useState(false);
  const [isLoadingOperationalSettings, setIsLoadingOperationalSettings] = useState(false);
  const [operationalSettingsLoaded, setOperationalSettingsLoaded] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [reservationToCancel, setReservationToCancel] = useState<Reservation | null>(null);
  const cancelResolverRef = useRef<((result: boolean) => void) | null>(null);
  const selectedTodayServiceWasManualRef = useRef(false);
  const [selectedTodayService, setSelectedTodayService] = useState<BookingService>(() => {
    const initialServices = getTodayTabServices(normalizeEnabledServices(settings.servicesEnabled));
    return getInitialTodayService(initialServices);
  });

  function updateSettings(action: SetStateAction<ManagerSettings>) {
    setSettings((current) => {
      const nextSettings = typeof action === 'function' ? action(current) : action;
      saveSettingsToStorage(nextSettings);
      return nextSettings;
    });
  }

  async function refreshForCurrentLocalDayIfNeeded() {
    const currentDate = getLocalDateString(new Date());

    if (currentDate === dayStatus.date) {
      return false;
    }

    console.log('[TODAY_DATE] day changed', {
      previousDate: dayStatus.date,
      currentDate,
    });

    setDayStatus((current) => ({
      ...current,
      date: currentDate,
    }));

    if (clientConfig && isValidClientConfig(clientConfig)) {
      await Promise.all([
        loadReservations(),
        loadFullyBookedStatus(currentDate),
      ]);
    }

    return true;
  }

  const enabledServices = useMemo(() => normalizeEnabledServices(settings.servicesEnabled), [settings.servicesEnabled]);
  const todayTabServices = useMemo(() => getTodayTabServices(enabledServices), [enabledServices]);
  const activeUserRole = useMemo(() => normalizeUserRole(clientConfig?.role), [clientConfig?.role]);
  const isSuperAdmin = activeUserRole === 'SUPER_ADMIN';
  const clientLicense = useMemo(() => getClientLicenseFromConfig(clientConfig), [clientConfig]);
  const availableManagedClients = useMemo(
    () => (Array.isArray(clientConfig?.availableClients) ? (clientConfig.availableClients as ManagedClientOption[]) : []),
    [clientConfig?.availableClients],
  );

  useEffect(() => {
    const clientColor = normalizeHexColor(clientConfig?.primary_color ?? clientConfig?.primaryColor ?? settings.primaryColor);
    const clientColorDark = mixColor(clientColor, 0.72);
    const rgb = hexToRgb(clientColor);
    document.documentElement.style.setProperty('--client-primary-color', clientColor);
    document.documentElement.style.setProperty('--client-primary-dark', clientColorDark);
    document.documentElement.style.setProperty('--client-primary-soft', `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, 0.16)`);
    document.documentElement.style.setProperty('--client-primary-border', `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, 0.34)`);
  }, [clientConfig?.primary_color, clientConfig?.primaryColor, settings.primaryColor]);

  function handleTodayServiceChange(service: BookingService) {
    selectedTodayServiceWasManualRef.current = true;
    setSelectedTodayService(service);
  }

  useEffect(() => {
    if (!selectedTodayServiceWasManualRef.current) {
      setSelectedTodayService(getInitialTodayService(todayTabServices));
      return;
    }

    if (!todayTabServices.includes(selectedTodayService)) {
      selectedTodayServiceWasManualRef.current = false;
      setSelectedTodayService(getInitialTodayService(todayTabServices));
    }
  }, [selectedTodayService, todayTabServices]);

  const todayActiveReservations = useMemo(() => {
    const filteredReservations = allReservations
      .filter((reservation) => normalizeDateForCompare(reservation.date) === dayStatus.date && isActiveReservation(reservation))
      .sort((a, b) => a.time.localeCompare(b.time));
    return filteredReservations;
  }, [allReservations, dayStatus.date]);

  const todayReservations = useMemo(
    () => todayActiveReservations.filter((reservation) => normalizeBookingService(reservation.service) === selectedTodayService),
    [selectedTodayService, todayActiveReservations],
  );

  const reservationsList = useMemo(() => allReservations, [allReservations]);

  const totalPax = useMemo(
    () => todayReservations.reduce((total, reservation) => total + reservation.pax, 0),
    [todayReservations],
  );

  const arrivals = useMemo(
    () => todayReservations.filter((reservation) => reservation.arrived).length,
    [todayReservations],
  );

  const occupancyPercent = Math.min(100, Math.round((totalPax / settings.totalCapacity) * 100));

  const activeTableOptions = useMemo(
    () => restaurantTables.filter((table) => table.active).map((table) => table.name),
    [restaurantTables],
  );

  const todayBookingStatus = dateBookingStatus[dayStatus.date] ?? (settings.reservasActivas ? 'open' : 'fully_booked');
  const isTodayFullyBooked = todayBookingStatus === 'fully_booked';
  const isDemoClient = Boolean(clientConfig && (clientConfig.IS_DEMO === true || clientConfig.is_demo === true || toSupabaseBoolean(clientConfig.IS_DEMO) || toSupabaseBoolean(clientConfig.is_demo)));
  const isProtectedDemoUser = String(clientConfig?.authUserEmail ?? '').trim().toLowerCase() === PROTECTED_DEMO_EMAIL;

  useEffect(() => {
    isLoadingReservationsRef.current = isLoadingReservations;
  }, [isLoadingReservations]);

  useEffect(() => {
    document.body.classList.remove('role-superadmin', 'role-manager');

    if (!clientConfig) {
      return;
    }

    document.body.classList.add(isSuperAdmin && !isProtectedDemoUser ? 'role-superadmin' : 'role-manager');

    return () => {
      document.body.classList.remove('role-superadmin', 'role-manager');
    };
  }, [clientConfig, isProtectedDemoUser, isSuperAdmin]);

  useEffect(() => {
    if (!clientConfig) {
      return;
    }

    if (!isSupabaseDemoRoute()) {
      console.log('[BOOT] loading initial reservations only');
      void loadReservations();
    }
  }, [clientConfig]);

  useEffect(() => {
    if (!USE_MANAGER_API || !clientConfig || !isValidClientConfig(clientConfig)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || isLoadingReservationsRef.current) {
        return;
      }

      void supabase.auth.getSession().then(({ data }) => {
        if (!data.session || isLoadingReservationsRef.current) {
          return;
        }

        console.log('[AUTO_REFRESH] reservations.list');
        void loadReservations();
      });
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [clientConfig]);

  useEffect(() => {
    if (!clientConfig || !isValidClientConfig(clientConfig)) {
      return undefined;
    }

    const checkCurrentDay = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void refreshForCurrentLocalDayIfNeeded();
    };

    const intervalId = window.setInterval(checkCurrentDay, 60_000);
    document.addEventListener('visibilitychange', checkCurrentDay);
    window.addEventListener('focus', checkCurrentDay);
    window.addEventListener('pageshow', checkCurrentDay);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', checkCurrentDay);
      window.removeEventListener('focus', checkCurrentDay);
      window.removeEventListener('pageshow', checkCurrentDay);
    };
  }, [clientConfig, dayStatus.date]);

  useEffect(() => {
    if (activePage === 'feedbacks' && !feedbacksLoaded && !isLoadingFeedbacks) {
      console.log('[LAZY] loading feedbacks');
      void loadFeedbacks();
    } else if (activePage === 'feedbacks' && feedbacksLoaded) {
      console.log('[CACHE] feedbacks already loaded');
    }
  }, [activePage, feedbacksLoaded, isLoadingFeedbacks]);

  useEffect(() => {
    if (activePage === 'settings' && !hasLoadedTables && !isLoadingTables) {
      console.log('[LAZY] loading tables');
      void loadTables();
    } else if (activePage === 'settings' && hasLoadedTables) {
      console.log('[CACHE] tables already loaded');
    }
  }, [activePage, hasLoadedTables, isLoadingTables]);

  useEffect(() => {
    if (activePage === 'settings' && shouldUseManagerApiForResources()) {
      void loadResources();
    }
  }, [activePage, clientConfig?.client_id]);

  useEffect(() => {
    if (
      activePage === 'today'
      && selectedTodayService === 'BALINESA'
      && reservableResources.length === 0
      && !isLoadingResources
      && shouldUseManagerApiForResources()
    ) {
      void loadResources();
    }
  }, [activePage, selectedTodayService, reservableResources.length, isLoadingResources, clientConfig?.client_id]);

  useEffect(() => {
    if (activePage === 'settings' && !operationalSettingsLoaded && !isLoadingOperationalSettings) {
      void loadSettingsFromMake();
    }
  }, [activePage, operationalSettingsLoaded, isLoadingOperationalSettings]);

  useEffect(() => {
    if (clientConfig) {
      console.log('CLIENTE ACTIVO:', clientConfig.client_id, clientConfig.rest_nombre);
      console.log('WEBHOOKS ACTIVOS:', {
        get: clientConfig.webhook_get_reservas,
        manual: clientConfig.webhook_manual,
        walkin: clientConfig.webhook_walkin,
      });
      setAllReservations([]);
      setRestaurantTables([]);
      console.log('[RESOURCES][SET]', 'clientConfig effect reset', []);
      setReservableResources([]);
      setFeedbacks([]);
      setFeedbacksLoaded(false);
      setHasLoadedReservations(false);
      setHasLoadedTables(false);
      setOperationalSettingsLoaded(false);
      setSettingsMessage('');
      setTablesSyncMessage('');
      setDateBookingStatus({});
      setSettings((current) => populateAdminFromClientConfig(current, clientConfig));
      console.log('Admin cargado desde configuración cliente:', clientConfig.rest_nombre);
      if (isSupabaseDemoRoute()) {
        console.log('[MANAGER_API][BOOT] preload manager-api data');
        void Promise.all([
          loadReservations(),
          loadTables().then((tables) => {
            console.log('[MANAGER_API][TABLES] preloaded', tables.length);
          }),
          loadFullyBookedStatus(dayStatus.date),
          loadSettingsFromMake().then(() => {
            console.log('[DEMO][BOOT] settings preloaded');
          }),
          preloadDemoFeedbacks(),
        ]);
      } else {
        void loadSettingsFromMake();
      }
    }
  }, [clientConfig]);

  async function handleLogin(usuario: string, password: string) {
    setIsLoggingIn(true);
    setLoginError('');
    clearLoginSession();

    try {
      if (USE_MANAGER_API) {
        if (!isSupabaseConfigured) {
          throw new Error('Supabase no esta configurado');
        }

        const authResult = await supabase.auth.signInWithPassword({
          email: usuario.trim(),
          password,
        });

        if (authResult.error || !authResult.data.user) {
          console.error('[MANAGER_API] Login error:', authResult.error ?? 'No auth user returned');
          setLoginError('Usuario o contraseña incorrectos');
          return;
        }

        const config = normalizeClientConfig({
          ...(await loadSupabaseClientConfig(authResult.data.user.id)),
          authUserEmail: authResult.data.user.email ?? usuario.trim(),
        });
        if (!isValidClientConfig(config)) {
          throw new Error('CLIENT_CONFIG_INVALID');
        }

        sessionStorage.setItem(CLIENT_CONFIG_KEY, JSON.stringify(config));
        sessionStorage.setItem(LOGIN_FLAG_KEY, 'true');
        setAllReservations([]);
        setRestaurantTables([]);
        console.log('[RESOURCES][SET]', 'supabase login reset', []);
        setReservableResources([]);
        setFeedbacks([]);
        setFeedbacksLoaded(false);
        setHasLoadedReservations(false);
        setHasLoadedTables(false);
        setOperationalSettingsLoaded(false);
        setSettingsMessage('');
        setTablesSyncMessage('');
        setClientConfig(config);
        setSettings((current) => populateAdminFromClientConfig(current, config));
        console.log('Cliente cargado:', config.rest_nombre);
        console.log('Admin cargado desde configuración cliente:', config.rest_nombre);
        return;
      }

      console.log('[Login debug] URL llamada:', LOGIN_WEBHOOK_URL);
      const response = await fetch(LOGIN_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ usuario, password }),
      });

      console.log('[Login debug] Status HTTP recibido:', response.status, response.statusText);

      if (!response.ok) {
        console.warn('[Login debug] Punto de error: response.ok es false. Se mostrará "Usuario o contraseña incorrectos".');
        throw new Error(`Login request failed with status ${response.status}`);
      }

      const loginResponse = (await response.json()) as ExternalClientConfig;
      console.log('[Login debug] JSON completo recibido:', loginResponse);
      console.log('[Login debug] Valor de response.success:', loginResponse.success);
      const loginDebugSnapshot = {
        success: loginResponse.success,
        client_id: loginResponse.client_id,
        rest_nombre: loginResponse.rest_nombre,
      };

      if (!isValidClientConfig(loginResponse)) {
        console.warn('[Login debug] Punto de error: isValidClientConfig(loginResponse) es false. Se mostrará "Usuario o contraseña incorrectos".', {
          success: loginDebugSnapshot.success,
          client_id: loginDebugSnapshot.client_id,
          rest_nombre: loginDebugSnapshot.rest_nombre,
        });
        clearLoginSession();
        setClientConfig(null);
        setLoginError('Usuario o contraseña incorrectos');
        return;
      }

      const config = normalizeClientConfig(loginResponse);
      sessionStorage.setItem(CLIENT_CONFIG_KEY, JSON.stringify(config));
      sessionStorage.setItem(LOGIN_FLAG_KEY, 'true');
      setAllReservations([]);
      setRestaurantTables([]);
      console.log('[RESOURCES][SET]', 'legacy login reset', []);
      setReservableResources([]);
      setFeedbacks([]);
      setFeedbacksLoaded(false);
      setHasLoadedReservations(false);
      setHasLoadedTables(false);
      setOperationalSettingsLoaded(false);
      setSettingsMessage('');
      setTablesSyncMessage('');
      setClientConfig(config);
      setSettings((current) => populateAdminFromClientConfig(current, config));
      console.log('Cliente cargado:', config.rest_nombre);
      console.log('Admin cargado desde configuración cliente:', config.rest_nombre);
    } catch (error) {
      console.warn('[Login debug] Punto de error: catch ejecutado. Se mostrara "Usuario o contrasena incorrectos".', error);
      clearLoginSession();
      setClientConfig(null);
      setLoginError('Usuario o contraseña incorrectos');
    } finally {
      setIsLoggingIn(false);
    }
  }

  function handleLogout() {
    if (USE_MANAGER_API) {
      void supabase.auth.signOut();
    }
    clearLoginSession();
    setClientConfig(null);
    setRestaurantTables([]);
    console.log('[RESOURCES][SET]', 'logout reset', []);
    setReservableResources([]);
    setFeedbacks([]);
    setFeedbacksLoaded(false);
    setHasLoadedReservations(false);
    setHasLoadedTables(false);
    setOperationalSettingsLoaded(false);
    setSettingsMessage('');
    setActivePage('today');
    onLogoutComplete?.();
  }

  function resetManagerDataForClientChange(origin: string) {
    clearSettingsStorage();
    clearDateBookingStatusStorage();
    setAllReservations([]);
    setRestaurantTables([]);
    console.log('[RESOURCES][SET]', origin, []);
    setReservableResources([]);
    setFeedbacks([]);
    setFeedbacksLoaded(false);
    setHasLoadedReservations(false);
    setHasLoadedTables(false);
    setOperationalSettingsLoaded(false);
    setDateBookingStatus({});
    setSettingsMessage('');
    setTablesSyncMessage('');
    setResourcesSyncMessage('');
    setLastUpdatedAt('');
    setReservationToCancel(null);
    selectedTodayServiceWasManualRef.current = false;
    setSelectedTodayService(getInitialTodayService(getTodayTabServices(normalizeEnabledServices(settings.servicesEnabled))));
  }

  async function handleManagedClientChange(nextClientId: string) {
    if (isProtectedDemoUser) {
      setLastSync('Modo demo: no se puede cambiar el cliente activo');
      return;
    }

    if (!isSuperAdmin || !nextClientId || nextClientId === clientConfig?.client_id) {
      return;
    }

    try {
      console.log('[SUPER_ADMIN][CLIENT_SWITCH]', {
        profileClientId: clientConfig?.authProfileClientId ?? clientConfig?.profile_client_id,
        selectedClientId: nextClientId,
        previousEffectiveClientId: clientConfig?.effectiveClientId ?? clientConfig?.client_id,
      });
      setLastSync('Cambiando cliente...');
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;

      if (!userId) {
        setLastSync('Sesion Supabase no disponible');
        return;
      }

      const nextConfig = normalizeClientConfig({
        ...(await loadSupabaseClientConfig(userId, nextClientId)),
        authUserEmail: data.session?.user.email ?? clientConfig?.authUserEmail ?? '',
      });
      console.log('[SUPER_ADMIN][CLIENT_SWITCH_READY]', {
        profileClientId: nextConfig.authProfileClientId ?? nextConfig.profile_client_id,
        selectedClientId: nextConfig.selectedClientId ?? nextConfig.client_id,
        effectiveClientId: nextConfig.effectiveClientId ?? nextConfig.client_id,
      });
      sessionStorage.setItem(CLIENT_CONFIG_KEY, JSON.stringify(nextConfig));
      sessionStorage.setItem(LOGIN_FLAG_KEY, 'true');
      resetManagerDataForClientChange('superadmin client switch reset');
      setClientConfig(nextConfig);
      setSettings(() => populateAdminFromClientConfig(loadSettingsFromStorage(), nextConfig));
      setLastSync(`Cliente activo: ${nextConfig.rest_nombre}`);
    } catch (error) {
      console.error('[SUPER_ADMIN] client switch error', error);
      setLastSync('No se pudo cambiar de cliente');
    }
  }

  function getReservationSyncId(reservation: Reservation) {
    return reservation.idReserva || reservation.id;
  }

  function blockProtectedDemoAction(message = 'Modo demo: esta accion esta bloqueada', temporaryAllowedClientId?: string) {
    if (!isProtectedDemoUser || (temporaryAllowedClientId && String(clientConfig?.client_id ?? '').trim() === temporaryAllowedClientId)) {
      return false;
    }

    setLastSync(message);
    setSettingsMessage(message);
    setTablesSyncMessage(message);
    setResourcesSyncMessage(message);
    return true;
  }

  function canSyncReservationAction(reservation: Reservation, actionLabel: string) {
    if (!getReservationSyncId(reservation) || !reservation.date || !reservation.time) {
      setLastSync(`Faltan datos para sincronizar ${actionLabel}`);
      return false;
    }

    return true;
  }

  async function syncWebhook(webhookUrl: string, payload: unknown, missingMessage = 'Webhook no configurado') {
    const result = await sendWebhook(webhookUrl, payload);
    if (result.success) {
      setLastSync('Sincronizado correctamente');
      return result;
    }

    setLastSync(result.skipped ? missingMessage : 'Cambio guardado en la app, pero no sincronizado');
    return result;
  }

  function isSupabaseDemoRoute() {
    const isDemoPath = window.location.pathname.toLowerCase().startsWith('/demo');
    return (isDemoPath || USE_MANAGER_API) && clientConfig?.auth_provider === 'supabase';
  }

  function shouldUseManagerApiForTables() {
    return USE_MANAGER_API && Boolean(clientConfig);
  }

  function shouldUseManagerApiForResources() {
    return USE_MANAGER_API && Boolean(clientConfig);
  }

  function shouldUseManagerApiForReservations() {
    return USE_MANAGER_API && Boolean(clientConfig);
  }

  async function loadFullyBookedStatus(date: string) {
    if (!isSupabaseDemoRoute()) {
      return;
    }

    const requestGeneration = fullyBookedGenerationRef.current[date] ?? 0;

    try {
      const fullyBooked = await loadFullyBookedFromManagerApi(date);
      if ((fullyBookedGenerationRef.current[date] ?? 0) !== requestGeneration) {
        return;
      }
      setDateBookingStatus((current) => {
        const nextStatus = {
          ...current,
          [date]: fullyBooked ? 'fully_booked' : 'open',
        } satisfies DateBookingStatus;
        saveDateBookingStatusToStorage(nextStatus);
        return nextStatus;
      });
    } catch (error) {
      console.warn('[DEMO][FULLYBOOKED] fallback local status', error);
    }
  }

  const loadVisibleFullyBookedStatuses = (dates: string[]) => {
    const uniqueDates = [...new Set(dates)];
    void Promise.all(uniqueDates.map((date) => loadFullyBookedStatus(date)));
  };

  async function loadReservations() {
    const demoReservationListWebhook = typeof clientConfig?.webhooks?.RESERVATION_LIST === 'string' ? clientConfig.webhooks.RESERVATION_LIST : '';
    const reservationsWebhook = clientConfig?.auth_provider === 'supabase' && demoReservationListWebhook ? demoReservationListWebhook : getClientWebhook('webhook_get_reservas');
    const sheetId = getClientSheetId();
    const isDemo = isSupabaseDemoRoute();
    const shouldUseManagerApiReservations = USE_MANAGER_API && Boolean(clientConfig);

    setIsLoadingReservations(true);

    try {
      if (shouldUseManagerApiReservations) {
        try {
          const nextReservations = await loadReservationsFromManagerApi();
          const normalizedReservations = normalizeDemoReservations(nextReservations as unknown as Array<Record<string, unknown>>);
          setAllReservations(normalizedReservations);
          setHasLoadedReservations(true);
          setLastUpdatedAt(getCurrentTime({ includeSeconds: true }));
          setLastSync('Datos actualizados correctamente');
          return;
        } catch (error) {
          console.warn('[MANAGER_API] reservations.list failed', error);
          setAllReservations([]);
          setHasLoadedReservations(true);
          setLastSync('No se pudieron cargar las reservas con manager-api');
          return;
        }
      }

      if (!reservationsWebhook.trim()) {
        setLastSync('Webhook leer reservas no configurado');
        return;
      }

      if (clientConfig?.auth_provider === 'supabase') {
        const response = await fetch(reservationsWebhook.trim(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientConfig.client_id,
            sheet_id: clientConfig.sheet_id,
            action: 'RESERVATION_LIST',
          }),
        });

        if (!response.ok) {
          throw new Error(`No se pudieron cargar las reservas demo (${response.status})`);
        }

        const responseText = await response.text();
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
          throw new Error(`RESERVATION_LIST no devolvio JSON valido: ${responseText.slice(0, 80)}`);
        }
        console.log('[DEMO] RESERVATION_LIST response', data);
        const rows = data.reservations ?? data.reservas ?? data.data ?? data.rows ?? [];
        setAllReservations(Array.isArray(rows) ? normalizeDemoReservations(rows as Array<Record<string, unknown>>) : []);
        setHasLoadedReservations(true);
        setLastUpdatedAt(getCurrentTime({ includeSeconds: true }));
        setLastSync('Datos actualizados correctamente');
        return;
      }

      const nextReservations = await loadReservationsFromWebhook(reservationsWebhook, sheetId);
      setAllReservations(nextReservations);
      setHasLoadedReservations(true);
      setLastUpdatedAt(getCurrentTime({ includeSeconds: true }));
      setLastSync('Datos actualizados correctamente');
    } catch (error) {
      console.error('GET_RESERVATIONS error', error);
      setLastSync('No se pudieron cargar las reservas');
    } finally {
      setIsLoadingReservations(false);
    }
  }

  async function loadTables() {
    const sheetId = getClientSheetId();
    const useManagerApiTables = shouldUseManagerApiForTables();
    console.log('[DEMO] route:', window.location.pathname);
    console.log('[DEMO] isDemo:', isSupabaseDemoRoute());
    console.log('[DEMO] loadTables() started');

    setIsLoadingTables(true);

    if (useManagerApiTables) {
      try {
        console.log('[MANAGER_API][TABLES] attempting tables.list');
        const nextTables = await loadTablesFromSupabaseEdge({ sheetId, clientId: clientConfig?.client_id, clientConfig });
        setRestaurantTables(nextTables);
        console.log('[MANAGER_API][TABLES] setTables applied');
        setHasLoadedTables(true);
        setTablesSyncMessage(nextTables.length ? 'Mesas actualizadas correctamente' : 'No hay mesas configuradas para este restaurante.');
        setIsLoadingTables(false);
        return nextTables;
      } catch (error) {
        const fallbackCode = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
        console.warn('[MANAGER_API][TABLES] tables.list failed', fallbackCode, error);
        setRestaurantTables([]);
        setHasLoadedTables(true);
        setTablesSyncMessage('No se pudieron cargar mesas con manager-api');
        setIsLoadingTables(false);
        return [];
      }
    }

    const tablesWebhook = getClientWebhook('webhook_get_mesas') || settings.webhookGetMesas;

    if (!tablesWebhook.trim()) {
      setRestaurantTables([]);
      setTablesSyncMessage(useManagerApiTables ? 'No se pudieron cargar mesas' : 'Webhook de mesas no configurado');
      setHasLoadedTables(true);
      setIsLoadingTables(false);
      return [];
    }

    try {
      const nextTables = await loadRestaurantTables(tablesWebhook, sheetId, clientConfig?.client_id);
      setRestaurantTables(nextTables);
      setHasLoadedTables(true);
      setTablesSyncMessage(nextTables.length ? 'Mesas actualizadas correctamente' : 'No hay mesas configuradas para este restaurante.');
      return nextTables;
    } catch (error) {
      console.error('GET_MESAS error', error);
      setRestaurantTables([]);
      setTablesSyncMessage('No se pudieron cargar mesas');
      return [];
    } finally {
      setIsLoadingTables(false);
    }
  }

  async function ensureTablesForAssignment() {
    console.log('[LAZY][TABLES] needed for table assignment');
    if (hasLoadedTables) {
      console.log('[CACHE][TABLES] using cached tables');
      return;
    }

    console.log('[LAZY][TABLES] loading before opening selector');
    const nextTables = await loadTables();
    console.log('[LAZY][TABLES] loaded X tables', nextTables?.length ?? 0);
  }

  async function loadResources() {
    const sheetId = getClientSheetId();

    if (!shouldUseManagerApiForResources()) {
      console.log('[RESOURCES][SET]', 'loadResources disabled', []);
      setReservableResources([]);
      setResourcesSyncMessage('Recursos disponibles solo con manager-api');
      return [];
    }

    setIsLoadingResources(true);
    try {
      const nextResources = await loadResourcesWithManagerApi({ sheetId, clientId: clientConfig?.client_id, clientConfig });
      console.log('[RESOURCES][LOADED]', nextResources);
      console.log('[RESOURCES][SET]', 'loadResources success', nextResources);
      setReservableResources(nextResources);
      setResourcesSyncMessage(nextResources.length ? 'Recursos actualizados correctamente' : 'No hay recursos configurados.');
      return nextResources;
    } catch (error) {
      console.error('[MANAGER_API][RESOURCES] error', error);
      console.log('[RESOURCES][SET]', 'loadResources error keeping current resources', reservableResources);
      setResourcesSyncMessage('No se pudieron cargar recursos');
      return [];
    } finally {
      setIsLoadingResources(false);
    }
  }

  async function loadFeedbacks() {
    const feedbacksWebhook = getClientWebhook('webhook_feedbacks') || settings.webhookFeedbacks;
    const sheetId = getClientSheetId();

    setIsLoadingFeedbacks(true);

    try {
      if (isSupabaseDemoRoute()) {
        try {
          const nextFeedbacks = await loadFeedbacksFromManagerApi();
          setFeedbacks(nextFeedbacks);
          setFeedbacksLoaded(true);
          setFeedbacksMessage(nextFeedbacks.length ? 'Feedbacks actualizados correctamente' : 'No hay feedbacks todavia.');
          return nextFeedbacks;
        } catch (error) {
          console.warn('[MANAGER_API] feedbacks.list failed', error);
          setFeedbacks([]);
          setFeedbacksLoaded(true);
          setFeedbacksMessage('No se pudieron cargar los feedbacks con manager-api');
          return [];
        }
      }

      if (!feedbacksWebhook.trim()) {
        setFeedbacks([]);
        setFeedbacksLoaded(true);
        setFeedbacksMessage('Webhook de feedbacks no configurado.');
        return [];
      }

      const nextFeedbacks = await loadFeedbacksFromWebhook(feedbacksWebhook, sheetId);
      setFeedbacks(nextFeedbacks);
      setFeedbacksLoaded(true);
      setFeedbacksMessage(nextFeedbacks.length ? 'Feedbacks actualizados correctamente' : 'No hay feedbacks todavía.');
    } catch (error) {
      console.error('GET_FEEDBACKS error', error);
      setFeedbacks([]);
      setFeedbacksLoaded(true);
      setFeedbacksMessage('No se pudieron cargar los feedbacks');
    } finally {
      setIsLoadingFeedbacks(false);
    }
  }

  async function preloadDemoFeedbacks(): Promise<Feedback[]> {
    setIsLoadingFeedbacks(true);

    try {
      const nextFeedbacks = await loadFeedbacksFromManagerApi();
      setFeedbacks(nextFeedbacks);
      setFeedbacksLoaded(true);
      setFeedbacksMessage(nextFeedbacks.length ? 'Feedbacks actualizados correctamente' : 'No hay feedbacks todavia.');
      console.log('[DEMO][BOOT] feedbacks preloaded X', nextFeedbacks.length);
      setIsLoadingFeedbacks(false);
      return nextFeedbacks;
    } catch (error) {
      console.warn('[MANAGER_API] feedbacks.list preload failed', error);
      setFeedbacks([]);
      setFeedbacksLoaded(true);
      setFeedbacksMessage('No se pudieron cargar los feedbacks con manager-api');
      console.log('[DEMO][BOOT] feedbacks preloaded X', 0);
      setIsLoadingFeedbacks(false);
      return [];
    }

    const feedbacksWebhook = getClientWebhook('webhook_feedbacks') || settings.webhookFeedbacks;
    const sheetId = getClientSheetId();

    if (!feedbacksWebhook.trim()) {
      setFeedbacks([]);
      setFeedbacksLoaded(true);
      setFeedbacksMessage('Webhook de feedbacks no configurado.');
      console.log('[DEMO][BOOT] feedbacks preloaded X', 0);
      setIsLoadingFeedbacks(false);
      return [];
    }

    try {
      const nextFeedbacks = await loadFeedbacksFromWebhook(feedbacksWebhook, sheetId);
      setFeedbacks(nextFeedbacks);
      setFeedbacksLoaded(true);
      setFeedbacksMessage(nextFeedbacks.length ? 'Feedbacks actualizados correctamente' : 'No hay feedbacks todavia.');
      console.log('[DEMO][BOOT] feedbacks preloaded X', nextFeedbacks.length);
      return nextFeedbacks;
    } catch (error) {
      console.error('GET_FEEDBACKS error', error);
      setFeedbacks([]);
      setFeedbacksLoaded(true);
      setFeedbacksMessage('No se pudieron cargar los feedbacks');
      console.log('[DEMO][BOOT] feedbacks preloaded X', 0);
      return [];
    } finally {
      setIsLoadingFeedbacks(false);
    }
  }

  function getOperationalSettingsWebhook() {
    return getClientWebhook('webhook_settings') || settings.webhookSettings || SETTINGS_WEBHOOK_FALLBACK;
  }

  function getCapacityReadWebhook() {
    const getCapacityUrl = getClientWebhook('webhook_get_capacidad') || settings.webhookGetCapacidad;
    if (!getCapacityUrl.trim()) {
      console.warn('No hay WEBHOOK_GET_CAPACIDAD configurado; usando fallback');
    }
    return getCapacityUrl || getClientWebhook('webhook_capacidad') || settings.webhookSettingsCapacityUrl;
  }

  function getCapacitySaveWebhook() {
    return getClientWebhook('webhook_capacidad') || settings.webhookSettingsCapacityUrl;
  }

  function buildVisibleSlotCapacity(sourceSettings: ManagerSettings, loadedCapacity: Record<string, number> = {}) {
    const visibleSlots = generateTimeSlots(sourceSettings.openingTime, sourceSettings.closingTime, sourceSettings.bookingInterval);
    const fallbackCapacity = sourceSettings.totalCapacity || 40;

    return visibleSlots.reduce<Record<string, number>>((slots, slot) => {
      slots[slot] = loadedCapacity[slot] ?? sourceSettings.slotCapacity[slot] ?? fallbackCapacity;
      return slots;
    }, {});
  }

  async function loadCapacityFromMake(baseSettings?: ManagerSettings) {
    console.log('LOAD CAPACITY START');
    const isDemo = isSupabaseDemoRoute();

    if (isDemo) {
      try {
        const loadedCapacity = await loadCapacityFromManagerApi();
        const capacityMap = (loadedCapacity as Record<string, unknown>).CENA && typeof (loadedCapacity as Record<string, unknown>).CENA === 'object'
          ? (loadedCapacity as unknown as Record<string, Record<string, number>>).CENA
          : loadedCapacity as Record<string, number>;
        setSettings((current) => {
          const mergedSource = baseSettings ?? current;
          const serviceSlotCapacity = loadedCapacity as unknown as Record<'DESAYUNO' | 'ALMUERZO' | 'CENA', Record<string, number>>;
          const nextSettings = {
            ...mergedSource,
            slotCapacity: buildVisibleSlotCapacity(mergedSource, capacityMap),
            ...(serviceSlotCapacity.CENA ? { serviceSlotCapacity } : {}),
          };
          saveSettingsToStorage(nextSettings);
          return nextSettings;
        });
        return true;
      } catch (error) {
        console.warn('[MANAGER_API] capacity.list failed', error);
        setSettings((current) => {
          const mergedSource = baseSettings ?? current;
          const nextSettings = {
            ...mergedSource,
            slotCapacity: buildVisibleSlotCapacity(mergedSource),
          };
          saveSettingsToStorage(nextSettings);
          return nextSettings;
        });
        setSettingsMessage('No se pudo cargar CAPACIDAD con manager-api. Usando defaults seguros.');
        return false;
      }
    }

    const capacityWebhook = getCapacityReadWebhook();
    console.log('GET CAPACITY webhook URL usado:', capacityWebhook);

    if (!capacityWebhook.trim()) {
      setSettings((current) => {
        const mergedSource = baseSettings ?? current;
        const nextSettings = {
          ...mergedSource,
          slotCapacity: buildVisibleSlotCapacity(mergedSource),
        };
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      setSettingsMessage((current) =>
        current && current !== 'Cargando SETTINGS...'
          ? `${current} Capacidad no configurada.`
          : 'Webhook de capacidad no configurado. Usando defaults seguros.',
      );
      return false;
    }

    try {
      const loadedCapacity = await loadCapacitySettings(capacityWebhook);
      setSettings((current) => {
        const mergedSource = baseSettings ?? current;
        const nextSettings = {
          ...mergedSource,
          slotCapacity: buildVisibleSlotCapacity(mergedSource, loadedCapacity),
        };
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      return true;
    } catch (error) {
      console.error('error al cargar capacidad', error);
      setSettings((current) => {
        const mergedSource = baseSettings ?? current;
        const nextSettings = {
          ...mergedSource,
          slotCapacity: buildVisibleSlotCapacity(mergedSource),
        };
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      setSettingsMessage('No se pudo cargar CAPACIDAD. Usando defaults seguros.');
      return false;
    }
  }

  async function loadSettingsFromMake() {
    const settingsWebhook = getOperationalSettingsWebhook();
    const isDemo = isSupabaseDemoRoute();

    if (isDemo) {
      setIsLoadingOperationalSettings(true);
      setSettingsMessage('Cargando SETTINGS...');

      try {
        const rawSettings = await loadOperationalSettingsFromManagerApi();
        let nextSettingsSnapshot: ManagerSettings | null = null;
        setSettings((current) => {
          const nextSettings = applyOperationalSettings(current, rawSettings);
          nextSettings.slotCapacity = buildVisibleSlotCapacity(nextSettings);
          nextSettingsSnapshot = nextSettings;
          saveSettingsToStorage(nextSettings);
          return nextSettings;
        });
        const capacityLoaded = await loadCapacityFromMake(nextSettingsSnapshot ?? undefined);
        setOperationalSettingsLoaded(true);
        if (capacityLoaded) {
          setSettingsMessage('SETTINGS cargados correctamente');
        }
        setIsLoadingOperationalSettings(false);
        return;
      } catch (error) {
        console.warn('[MANAGER_API] settings.get failed', error);
        setSettingsMessage('No se pudieron cargar SETTINGS con manager-api.');
        setOperationalSettingsLoaded(true);
        setIsLoadingOperationalSettings(false);
        return;
      }
    }

    if (!settingsWebhook.trim()) {
      let nextSettingsSnapshot: ManagerSettings | null = null;
      setSettings((current) => {
        const nextSettings = {
          ...applyOperationalDefaults(current),
        };
        nextSettings.slotCapacity = buildVisibleSlotCapacity(nextSettings);
        nextSettingsSnapshot = nextSettings;
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      setOperationalSettingsLoaded(true);
      setSettingsMessage('Webhook SETTINGS no configurado. Usando defaults operativos.');
      await loadCapacityFromMake(nextSettingsSnapshot ?? undefined);
      return;
    }

    setIsLoadingOperationalSettings(true);
    setSettingsMessage('Cargando SETTINGS...');

    try {
      const rawSettings = await loadOperationalSettings(settingsWebhook);
      let nextSettingsSnapshot: ManagerSettings | null = null;
      setSettings((current) => {
        const nextSettings = applyOperationalSettings(current, rawSettings);
        nextSettings.slotCapacity = buildVisibleSlotCapacity(nextSettings);
        nextSettingsSnapshot = nextSettings;
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      const capacityLoaded = await loadCapacityFromMake(nextSettingsSnapshot ?? undefined);
      setOperationalSettingsLoaded(true);
      if (capacityLoaded) {
        setSettingsMessage('SETTINGS cargados correctamente');
      }
    } catch (error) {
      console.error('error al cargar SETTINGS', error);
      let nextSettingsSnapshot: ManagerSettings | null = null;
      setSettings((current) => {
        const nextSettings = applyOperationalDefaults(current);
        nextSettings.slotCapacity = buildVisibleSlotCapacity(nextSettings);
        nextSettingsSnapshot = nextSettings;
        saveSettingsToStorage(nextSettings);
        return nextSettings;
      });
      await loadCapacityFromMake(nextSettingsSnapshot ?? undefined);
      setOperationalSettingsLoaded(true);
      setSettingsMessage('No se pudieron cargar SETTINGS. Usando defaults operativos.');
    } finally {
      setIsLoadingOperationalSettings(false);
    }
  }

  async function refreshReservationsOnly() {
    const dayChanged = await refreshForCurrentLocalDayIfNeeded();
    if (dayChanged) {
      return;
    }

    await loadReservations();
  }

  async function syncTable(action: 'create' | 'update' | 'deactivate' | 'delete', table: RestaurantTable) {
    if (blockProtectedDemoAction('Modo demo: la gestion de mesas esta bloqueada', 'CB-DEMO-002')) {
      return;
    }

    const useManagerApiTables = shouldUseManagerApiForTables();
    const tableWebhook = getClientWebhook('webhook_save_mesa') || settings.webhookSaveMesa;

    if (action === 'delete' && !table.mesaId) {
      setTablesSyncMessage('No se puede borrar una mesa sin ID_MESA');
      return;
    }

    if (useManagerApiTables) {
      try {
        await saveRestaurantTableWithManagerApi({
          action,
          table,
          clientId: clientConfig?.client_id,
        });
        setTablesSyncMessage('Mesa sincronizada correctamente');
        await loadTables();
        return;
      } catch (error) {
        console.warn('[MANAGER_API][TABLES] save failed', error);
      }
    }

    if (!tableWebhook.trim()) {
      setTablesSyncMessage(useManagerApiTables ? 'No se pudo guardar la mesa' : 'Webhook de mesas no configurado');
      return;
    }

    try {
      await saveRestaurantTable(tableWebhook, {
        action,
        table,
        clientId: clientConfig?.client_id,
      });
      setTablesSyncMessage('Mesa sincronizada correctamente');
      await loadTables();
    } catch (error) {
      console.error('SAVE_MESA error', error);
      setTablesSyncMessage('No se pudo guardar la mesa');
    }
  }

  async function handleCreateTable(table: Omit<RestaurantTable, 'id' | 'active'>) {
    const nextTable: RestaurantTable = {
      ...table,
      id: `MESA-${Date.now()}`,
      active: true,
    };

    await syncTable('create', nextTable);
  }

  async function handleUpdateTable(table: RestaurantTable) {
    await syncTable('update', table);
  }

  async function handleDeactivateTable(table: RestaurantTable) {
    await syncTable('deactivate', { ...table, active: false });
  }

  async function handleDeleteTable(table: RestaurantTable) {
    await syncTable('delete', table);
  }

  async function syncResource(action: 'create' | 'update' | 'delete', resource: ReservableResource) {
    if (blockProtectedDemoAction('Modo demo: la gestion de recursos esta bloqueada', 'CB-DEMO-002')) {
      return;
    }

    if (!shouldUseManagerApiForResources()) {
      setResourcesSyncMessage('Recursos disponibles solo con manager-api');
      return;
    }

    try {
      await saveResourceWithManagerApi({
        action,
        resource,
      });
      setResourcesSyncMessage('Recurso sincronizado correctamente');
      await loadResources();
    } catch (error) {
      console.error('SAVE_RESOURCE error', error);
      setResourcesSyncMessage('No se pudo guardar el recurso');
    }
  }

  async function handleCreateResource(resource: Omit<ReservableResource, 'id' | 'active'>) {
    const nextResource: ReservableResource = {
      ...resource,
      id: `BAL-${Date.now()}`,
      active: true,
    };

    await syncResource('create', nextResource);
  }

  async function handleUpdateResource(resource: ReservableResource) {
    await syncResource('update', resource);
  }

  async function handleDeleteResource(resource: ReservableResource) {
    await syncResource('delete', resource);
  }

  function applyClientBranding(restaurantName: string, primaryColor: string, restaurantLogoUrl: string, updatedClient?: ManagedClientOption) {
    setClientConfig((current) => {
      if (!current) {
        return current;
      }

      const targetClientId = updatedClient?.client_id || current.selectedClientId || current.client_id;
      const nextSelectedClient = current.selectedClient
        ? {
            ...current.selectedClient,
            ...(updatedClient ?? {}),
            rest_name: restaurantName,
            primary_color: primaryColor,
            logo_url: restaurantLogoUrl,
          }
        : current.selectedClient;
      const nextAvailableClients = Array.isArray(current.availableClients)
        ? current.availableClients.map((client) =>
            client.client_id === targetClientId
              ? {
                  ...client,
                  ...(updatedClient ?? {}),
                  rest_name: restaurantName,
                  primary_color: primaryColor,
                  logo_url: restaurantLogoUrl,
                }
              : client,
          )
        : current.availableClients;

      const nextConfig = normalizeClientConfig({
        ...current,
        rest_nombre: restaurantName,
        rest_name: restaurantName,
        restaurantName,
        color: primaryColor,
        primary_color: primaryColor,
        primaryColor,
        logo_url: restaurantLogoUrl,
        logo_restaurante: restaurantLogoUrl,
        restaurantLogoUrl,
        selectedClient: nextSelectedClient,
        availableClients: nextAvailableClients,
      });
      sessionStorage.setItem(CLIENT_CONFIG_KEY, JSON.stringify(nextConfig));
      return nextConfig;
    });
  }

  async function syncClientBranding(nextSettings: ManagerSettings) {
    if (blockProtectedDemoAction('Modo demo: el branding esta bloqueado')) {
      return false;
    }

    if (!isSuperAdmin) {
      return true;
    }

    const nextColor = normalizeHexColor(nextSettings.primaryColor);
    const currentColor = normalizeHexColor(clientConfig?.primary_color ?? clientConfig?.primaryColor);
    const nextLogoUrl = nextSettings.restaurantLogoUrl.trim();
    const currentLogoUrl = String(clientConfig?.logo_url ?? clientConfig?.logo_restaurante ?? clientConfig?.restaurantLogoUrl ?? '').trim();
    const nextRestaurantName = nextSettings.restaurantName.trim();
    const currentRestaurantName = String(clientConfig?.rest_name ?? clientConfig?.rest_nombre ?? clientConfig?.restaurantName ?? '').trim();

    if (nextColor === currentColor && nextLogoUrl === currentLogoUrl && nextRestaurantName === currentRestaurantName) {
      return true;
    }

    try {
      console.log('[BRANDING] saving client visible fields', {
        client_id: String(clientConfig?.effectiveClientId ?? clientConfig?.selectedClientId ?? clientConfig?.client_id ?? '').trim(),
        rest_name: nextRestaurantName,
        primary_color: nextColor,
        logo_url: nextLogoUrl,
      });
      const result = await saveClientBrandingWithManagerApi(nextColor, nextLogoUrl, nextRestaurantName);
      const updatedClient = mapManagedClient(result.client as unknown as Record<string, unknown>);
      applyClientBranding(updatedClient.rest_name || nextRestaurantName, nextColor, nextLogoUrl, updatedClient);
      setSettingsMessage('Cliente guardado en CLIENTES');
      return true;
    } catch (error) {
      console.error('[BRANDING] save error', error);
      setSettingsMessage('No se pudo guardar el cliente en CLIENTES');
      return false;
    }
  }

  async function syncValidatedWebhook(
    webhookUrl: string,
    payload: Record<string, unknown>,
    requiredFields: string[],
    actionLabel: string,
    missingMessage = 'Webhook no configurado',
    requiresNameOrRoom = false,
  ) {
    const requiredValidation = requireWebhookFields(payload, requiredFields, actionLabel);
    if (!requiredValidation.valid) {
      setLastSync(requiredValidation.message);
      return { success: false, skipped: true, error: requiredValidation.message };
    }

    if (requiresNameOrRoom) {
      const nameValidation = requireNameOrRoom(payload, actionLabel);
      if (!nameValidation.valid) {
        setLastSync(nameValidation.message);
        return { success: false, skipped: true, error: nameValidation.message };
      }
    }

    if (payload.id_reserva) {
      console.info('[Safari Manager] sync reservation', {
        accion: payload.accion,
        id_reserva: payload.id_reserva,
      });
    }

    return syncWebhook(webhookUrl, payload, missingMessage);
  }

  async function handleSettingsSave(nextSettings: ManagerSettings): Promise<'success' | 'error' | 'skipped'> {
    const isBalineseSettingsTrial = isProtectedDemoUser
      && String(clientConfig?.client_id ?? '').trim() === 'CB-DEMO-002'
      && Object.keys(nextSettings).filter((key) => !['servicesEnabled', 'serviceHours'].includes(key)).every((key) => JSON.stringify(nextSettings[key as keyof ManagerSettings]) === JSON.stringify(settings[key as keyof ManagerSettings]));
    if (!isBalineseSettingsTrial && blockProtectedDemoAction('Modo demo: guardar configuracion esta bloqueado')) {
      return 'skipped';
    }

    const settingsToSave = {
      ...nextSettings,
      primaryColor: normalizeHexColor(nextSettings.primaryColor),
    };
    updateSettings(settingsToSave);
    const capacitySlots = generateTimeSlots(settingsToSave.openingTime, settingsToSave.closingTime, settingsToSave.bookingInterval);
    const capacityPayload = buildCapacityPayload(settingsToSave.restaurantName, settingsToSave.slotCapacity, capacitySlots);
    const settingsWebhook = getOperationalSettingsWebhook();
    const capacityWebhook = getCapacitySaveWebhook();
    console.log('SAVE CAPACITY webhook URL:', capacityWebhook);
    setLastSync('Configuracion guardada correctamente');
    let settingsSavedByManagerApi = false;

    const brandingSaved = isBalineseSettingsTrial ? true : await syncClientBranding(settingsToSave);
    if (!brandingSaved) {
      return 'error';
    }

    if (isSupabaseDemoRoute()) {
      try {
        await saveOperationalSettingsWithManagerApi(settingsToSave);
        settingsSavedByManagerApi = true;
        setSettingsMessage('SETTINGS guardados correctamente');
      } catch (error) {
        console.warn('[MANAGER_API] settings.save failed', error);
        setSettingsMessage('No se pudieron guardar SETTINGS con manager-api');
        return 'error';
      }
    }

    if (!isSupabaseDemoRoute()) {
      if (!settingsWebhook.trim()) {
        setSettingsMessage('Webhook SETTINGS no configurado');
        return 'skipped';
      }

      try {
        await saveOperationalSettings(settingsWebhook, settingsToSave);
        setSettingsMessage('SETTINGS guardados correctamente');
      } catch (error) {
        console.error('error al guardar SETTINGS', error);
        setSettingsMessage('No se pudieron guardar SETTINGS');
        setLastSync('Configuracion guardada localmente, pero no sincronizada');
        return 'error';
      }
    } else if (!settingsSavedByManagerApi && settingsWebhook.trim()) {
      try {
        await saveOperationalSettings(settingsWebhook, settingsToSave);
        setSettingsMessage('SETTINGS guardados correctamente');
      } catch (error) {
        console.error('error al guardar SETTINGS', error);
        setSettingsMessage('No se pudieron guardar SETTINGS');
        setLastSync('Configuracion guardada localmente, pero no sincronizada');
        return 'error';
      }
    }

    if (!capacityWebhook.trim()) {
      if (!isSupabaseDemoRoute()) {
        setLastSync('Webhook de capacidad no configurado');
        return 'success';
      }
    }

    console.log('capacidad guardada', capacityPayload);
    if (isSupabaseDemoRoute()) {
      const serviceCapacities = settingsToSave.serviceSlotCapacity;
      setLastSync('Sincronizado correctamente');
      if (serviceCapacities) {
        for (const service of ['DESAYUNO', 'ALMUERZO', 'CENA'] as const) {
          if (!settingsToSave.servicesEnabled.includes(service)) continue;
          const configured = serviceCapacities[service] ?? {};
          const hours = generateTimeSlots(settingsToSave.serviceHours[service].start, settingsToSave.serviceHours[service].end, settingsToSave.bookingInterval);
          const slots = hours.map((hora) => ({ hora, limite: configured[hora] ?? 20, activo: (configured[hora] ?? 20) > 0 }));
          await saveCapacityWithManagerApi(slots, service);
        }
      }
      return 'success';
    }

    if (!capacityWebhook.trim()) {
      setLastSync('Webhook de capacidad no configurado');
      return 'success';
    }

    const capacityResult = await sendWebhook(
      capacityWebhook,
      capacityPayload,
    );

    if (capacityResult.success) {
      setLastSync('Sincronizado correctamente');
      return 'success';
    }

    console.error('error al guardar capacidad', capacityResult.error);
    setLastSync('Configuracion guardada localmente, pero no sincronizada');
    return 'error';
  }

  async function handleClientLicenseSave(nextLicense: ClientLicense): Promise<'success' | 'error'> {
    if (blockProtectedDemoAction('Modo demo: la licencia esta bloqueada')) {
      return 'error';
    }

    if (!isSuperAdmin) {
      setSettingsMessage('Solo SUPER_ADMIN puede cambiar la licencia');
      return 'error';
    }

    try {
      const savedLicense = await saveClientLicenseWithManagerApi(nextLicense);
      const normalizedLicense: ClientLicense = {
        status: normalizeClientLicenseStatus(savedLicense.status),
        plan: normalizeClientLicensePlan(savedLicense.plan),
        expiresAt: savedLicense.expiresAt ?? '',
      };

      setClientConfig((current) => {
        if (!current) {
          return current;
        }

        const nextSelectedClient = current.selectedClient
          ? {
              ...current.selectedClient,
              status: normalizedLicense.status,
              plan: normalizedLicense.plan,
              expires_at: normalizedLicense.expiresAt,
            }
          : current.selectedClient;
        const nextAvailableClients = Array.isArray(current.availableClients)
          ? current.availableClients.map((client) =>
              client.client_id === (current.selectedClientId ?? current.client_id)
                ? {
                    ...client,
                    status: normalizedLicense.status,
                    plan: normalizedLicense.plan,
                    expires_at: normalizedLicense.expiresAt,
                  }
                : client,
            )
          : current.availableClients;

        const nextConfig = normalizeClientConfig({
          ...current,
          status: normalizedLicense.status,
          plan: normalizedLicense.plan,
          expires_at: normalizedLicense.expiresAt,
          licenseStatus: normalizedLicense.status,
          licensePlan: normalizedLicense.plan,
          licenseExpiresAt: normalizedLicense.expiresAt,
          selectedClient: nextSelectedClient,
          availableClients: nextAvailableClients,
        });
        sessionStorage.setItem(CLIENT_CONFIG_KEY, JSON.stringify(nextConfig));
        return nextConfig;
      });

      setSettingsMessage('Licencia COSTABOTS guardada correctamente');
      setLastSync('Licencia actualizada');
      return 'success';
    } catch (error) {
      console.error('[LICENSE] save error', error);
      setSettingsMessage('No se pudo guardar la licencia COSTABOTS');
      return 'error';
    }
  }

  async function updateDateBookingStatus(date: string, status: DateBookingStatusValue) {
    fullyBookedGenerationRef.current[date] = (fullyBookedGenerationRef.current[date] ?? 0) + 1;
    setDateBookingStatus((current) => {
      const nextStatus = {
        ...current,
        [date]: status,
      };
      saveDateBookingStatusToStorage(nextStatus);
      return nextStatus;
    });
    setLastSync('Estado de reservas actualizado');

    if (isSupabaseDemoRoute()) {
      try {
        await saveFullyBookedWithManagerApi(date, status === 'fully_booked');
        setLastSync('Sincronizado correctamente');
        return;
      } catch (error) {
        console.warn('[MANAGER_API] fullybooked.set failed', error);
        setLastSync('No se pudo sincronizar fully booked con manager-api');
        return;
      }
    }

    await syncValidatedWebhook(getClientWebhook('webhook_fully_booked'), {
      accion: 'actualizar_fully_booked',
      fecha: date,
      fullyBooked: status === 'fully_booked',
    }, ['fecha'], 'fully booked');
    // Future Make integration: updateDateBookingStatus(date, status)
  }

  function handleBookingStatus() {
    void updateDateBookingStatus(dayStatus.date, isTodayFullyBooked ? 'open' : 'fully_booked');
    // Future Make integration: updateBookingStatus({ bookingsOpen, fullyBooked })
  }

  async function handleAddWalkIn(nameOrRoom: string, pax: number) {
    const walkInTime = getCurrentTime();
    const walkInService = getWalkInServiceForTime(walkInTime, settings);

    if (shouldUseManagerApiForReservations()) {
      const date = dayStatus.date;
      try {
        console.log('[MANAGER_API][WALKIN] creating', {
          clientId: clientConfig?.client_id,
          sheetId: getClientSheetId(),
          fecha: date,
          hora: walkInTime,
          pax,
          servicio: walkInService,
        });
        console.log('[WALKIN_SERVICE]', {
          time: walkInTime,
          servicesEnabled: settings.servicesEnabled,
          serviceHours: settings.serviceHours,
          calculatedService: walkInService,
        });
        console.log('[STEP1]', walkInService);
        const response = await createWalkInWithManagerApi({
          nombre: nameOrRoom || 'Walk-in',
          habitacion: /^\d+$/.test(nameOrRoom) ? nameOrRoom : '',
          fecha: date,
          hora: walkInTime,
          pax,
          idioma: 'ES',
          peticionEspecial: '',
          mesa: '',
          servicio: walkInService,
        });
        console.log('[MANAGER_API][WALKIN] append confirmed', response);
        setLastSync('Mesa añadida correctamente');
        console.log('[DEMO][WALKIN] refresh list');
        await loadReservations();
        return;
      } catch (error) {
        console.warn('[MANAGER_API] walkin.create failed', error);
        setLastSync('No se pudo crear walk-in con manager-api');
        return;
      }
    }

    const idReserva = createReservationId();
    const payload: WalkInPayload = {
      nameOrRoom,
      pax,
      date: dayStatus.date,
      time: walkInTime,
      status: 'CONFIRMADA',
      source: 'WALKIN',
    };

    const optimisticReservation: Reservation = {
      id: idReserva,
      idReserva,
      name: nameOrRoom,
      room: /^\d+$/.test(nameOrRoom) ? nameOrRoom : '',
      date: payload.date,
      time: payload.time,
      pax,
      specialRequest: '',
      status: 'CONFIRMADA',
      source: 'WALKIN',
      table: '',
      arrived: true,
      service: walkInService,
    };

    setAllReservations((current) => [...current, optimisticReservation]);
    setLastSync('Mesa añadida correctamente');
    void syncValidatedWebhook(getClientWebhook('webhook_walkin'), {
      accion: 'crear_walkin',
      id_reserva: optimisticReservation.idReserva,
      ID_RESERVA: optimisticReservation.idReserva,
      nombre: optimisticReservation.name,
      habitacion: optimisticReservation.room,
      fecha: optimisticReservation.date,
      hora: optimisticReservation.time,
      pax: optimisticReservation.pax,
      origen: 'WALK-IN',
      estado: 'CONFIRMADA',
      llego: true,
      servicio: walkInService,
      service: walkInService,
      SERVICIO: walkInService,
    }, ['id_reserva', 'fecha', 'hora', 'pax'], 'walk-in', 'Webhook no configurado', true);
  }

  async function addManualReservation(reservation: Omit<Reservation, 'id' | 'idReserva' | 'status' | 'source' | 'table' | 'arrived'>) {
    const reservationService = reservation.service ?? getWalkInServiceForTime(reservation.time, settings);

    if (shouldUseManagerApiForReservations()) {
      try {
        console.log('[MANAGER_API][RESERVATION_CREATE] creating', {
          clientId: clientConfig?.client_id,
          sheetId: getClientSheetId(),
          fecha: reservation.date,
          hora: reservation.time,
          pax: reservation.pax,
          servicio: reservationService,
        });
        const response = await createManualReservationWithManagerApi({
          nombre: reservation.name,
          habitacion: reservation.room,
          telefono: reservation.phone,
          fecha: reservation.date,
          hora: reservation.time,
          pax: reservation.pax,
          idioma: reservation.language ?? 'ES',
          peticionEspecial: reservation.specialRequest,
          mesa: '',
          llego: false,
          servicio: reservationService,
          service: reservationService,
          paqueteBalinesa: reservation.balinesePackage ?? '',
          balinesePackage: reservation.balinesePackage ?? '',
          recurso: reservation.resource ?? '',
          resource: reservation.resource ?? '',
        });
        if (reservationService === 'BALINESA' && reservation.balinesePaid) {
          const createdId = String(response.idReserva ?? '');
          if (createdId) {
            try {
              await setBalinesePaymentWithManagerApi(createdId, true);
            } catch {
              try {
                await loadReservations();
              } catch (refreshError) {
                console.warn('[MANAGER_API] reservation refresh after payment failure failed', refreshError);
              }
              setLastSync('La reserva se ha creado correctamente, pero no se pudo marcar como pagada. Puedes cambiar el estado de pago desde Reservas.');
              return;
            }
          }
        }
        console.log('[MANAGER_API][RESERVATION_CREATE] append confirmed', response);
        setLastSync('Reserva añadida correctamente');
        console.log('[DEMO][RESERVATION] refresh list');
        await loadReservations();
        return;
      } catch (error) {
        console.warn('[MANAGER_API] reservation.create failed', error);
        setLastSync('No se pudo crear la reserva con manager-api');
        throw error;
      }
    }

    const idReserva = createReservationId();
    const manualReservation: Reservation = {
      ...reservation,
      id: idReserva,
      idReserva,
      status: 'CONFIRMADA',
      source: 'MANUAL',
      table: '',
      arrived: false,
      service: reservationService,
      balinesePackage: reservation.balinesePackage,
      resource: reservation.resource,
    };

    setAllReservations((current) => [...current, manualReservation]);
    setLastSync('Reserva añadida correctamente');
    void syncValidatedWebhook(
      getClientWebhook('webhook_manual'),
      {
        accion: 'crear_reserva_manual',
        id_reserva: manualReservation.idReserva,
        ID_RESERVA: manualReservation.idReserva,
        nombre: manualReservation.name,
        habitacion: manualReservation.room,
        telefono: manualReservation.phone,
        fecha: manualReservation.date,
        hora: manualReservation.time,
        pax: manualReservation.pax,
        peticiones: manualReservation.specialRequest,
        origen: 'MANUAL',
        estado: 'CONFIRMADA',
        servicio: reservationService,
        service: reservationService,
        SERVICIO: reservationService,
        paqueteBalinesa: reservation.balinesePackage ?? '',
        PAQUETE_BALINESA: reservation.balinesePackage ?? '',
        recurso: reservation.resource ?? '',
        RECURSO: reservation.resource ?? '',
      },
      ['id_reserva', 'fecha', 'hora', 'pax'],
      'reserva manual',
      'Webhook de reservas no configurado',
      true,
    );
    // Future Make integration: addManualReservation(reservation)
  }

  async function handleUpdateReservation(id: string, field: 'table' | 'arrived', value: string | boolean) {
    const currentReservation = allReservations.find((reservation) => reservation.id === id);
    if (!currentReservation) {
      return;
    }

    const nextReservation = {
      ...currentReservation,
      [field]: value,
    };

    setAllReservations((current) =>
      current.map((reservation) => (reservation.id === id ? { ...reservation, [field]: value } : reservation)),
    );
    setLastSync('Guardando cambio...');

    if (!canSyncReservationAction(nextReservation, field === 'arrived' ? 'la llegada' : 'la mesa')) {
      return;
    }

    if (field === 'arrived') {
      if (shouldUseManagerApiForReservations()) {
        try {
          await saveArrivalWithManagerApi(getReservationSyncId(nextReservation), Boolean(nextReservation.arrived));
          setLastSync('Sincronizado correctamente');
          return;
        } catch (error) {
          console.warn('[MANAGER_API] reservation.arrive failed', error);
          setLastSync('No se pudo guardar llegada con manager-api');
          return;
        }
      }

      await syncValidatedWebhook(getClientWebhook('webhook_arrived'), {
        accion: 'actualizar_llegada',
        id_reserva: getReservationSyncId(nextReservation),
        ID_RESERVA: getReservationSyncId(nextReservation),
        fecha: nextReservation.date,
        hora: nextReservation.time,
        nombre: nextReservation.name,
        habitacion: nextReservation.room,
        llego: nextReservation.arrived,
      }, ['id_reserva', 'fecha', 'hora'], 'la llegada');
      return;
    }

    if (shouldUseManagerApiForReservations()) {
      try {
        await assignTableWithManagerApi(getReservationSyncId(nextReservation), String(nextReservation.table));
        setLastSync('Sincronizado correctamente');
        return;
      } catch (error) {
        console.warn('[MANAGER_API] reservation.assignTable failed', error);
        setLastSync('No se pudo asignar mesa con manager-api');
        return;
      }
    }

    await syncValidatedWebhook(getClientWebhook('webhook_mesa'), {
      accion: 'actualizar_mesa',
      id_reserva: getReservationSyncId(nextReservation),
      ID_RESERVA: getReservationSyncId(nextReservation),
      fecha: nextReservation.date,
      hora: nextReservation.time,
      nombre: nextReservation.name,
      habitacion: nextReservation.room,
      mesa: nextReservation.table,
    }, ['id_reserva', 'fecha', 'hora'], 'la mesa');
  }

  async function confirmCancelReservation() {
    if (!reservationToCancel) {
      return;
    }

    if (shouldUseManagerApiForReservations()) {
      try {
        await cancelReservationWithManagerApi(reservationToCancel.idReserva);
        setAllReservations((current) =>
          current.map((reservation) =>
            reservation.idReserva === reservationToCancel.idReserva ? { ...reservation, status: 'CANCELADA' } : reservation,
          ),
        );
        setReservationToCancel(null);
        setLastSync('Reserva cancelada');
        try {
          await loadReservations();
        } catch (refreshError) {
          console.warn('[DEMO][RESERVATION] refresh after cancel failed', refreshError);
        }
        cancelResolverRef.current?.(true);
        cancelResolverRef.current = null;
        return;
      } catch (error) {
        console.warn('[MANAGER_API] reservation.cancel failed', error);
        setLastSync('No se pudo cancelar con manager-api');
        cancelResolverRef.current?.(false);
        cancelResolverRef.current = null;
        return;
      }
    }

    const cancelWebhook = getClientWebhook('webhook_cancel');

    if (!cancelWebhook.trim()) {
      setLastSync('Webhook cancelar reserva no configurado');
      cancelResolverRef.current?.(false);
      cancelResolverRef.current = null;
      return;
    }

    const result = await sendWebhook<{ ok?: boolean; estado?: string }>(cancelWebhook, {
      action: 'CANCEL_BY_ID',
      id_reserva: reservationToCancel.idReserva,
    });

    if (result.success && result.data?.ok === true) {
      setAllReservations((current) =>
        current.map((reservation) =>
          reservation.idReserva === reservationToCancel.idReserva ? { ...reservation, status: 'CANCELADA' } : reservation,
        ),
      );
      setReservationToCancel(null);
      setLastSync('Reserva cancelada');
      return;
    }

    setLastSync('No se pudo cancelar la reserva');
    cancelResolverRef.current?.(false);
    cancelResolverRef.current = null;
  }

  function requestCancelReservation(reservation: Reservation) {
    return new Promise<boolean>((resolve) => {
      cancelResolverRef.current = resolve;
      setReservationToCancel(reservation);
    });
  }

  function rejectCancelReservation() {
    cancelResolverRef.current?.(false);
    cancelResolverRef.current = null;
    setReservationToCancel(null);
  }

  async function handleBalinesePayment(id: string, paid: boolean) {
    const current = allReservations.find((reservation) => reservation.id === id);
    if (!current || current.service !== 'BALINESA' || !shouldUseManagerApiForReservations()) return;
    setAllReservations((items) => items.map((reservation) => reservation.id === id ? { ...reservation, balinesePaid: paid } : reservation));
    setLastSync('Guardando pago...');
    try {
      await setBalinesePaymentWithManagerApi(getReservationSyncId(current), paid);
      setLastSync('Pago actualizado');
    } catch (error) {
      console.warn('[MANAGER_API] reservation.balinesePayment.set failed', error);
      setAllReservations((items) => items.map((reservation) => reservation.id === id ? { ...reservation, balinesePaid: current.balinesePaid } : reservation));
      setLastSync('No se pudo guardar el pago');
      throw error;
    }
  }

  function renderPage() {
    if (activePage === 'reservations') {
      return (
        <Reservations
          reservations={reservationsList}
          onRefreshReservations={refreshReservationsOnly}
          isRefreshingReservations={isLoadingReservations}
          lastUpdatedAt={lastUpdatedAt}
          onCancelReservation={requestCancelReservation}
          onBalinesePayment={handleBalinesePayment}
        />
      );
    }

    if (activePage === 'control') {
      return (
        <Control
          dateBookingStatus={dateBookingStatus}
          reservations={allReservations}
          totalCapacity={settings.totalCapacity}
          onDateBookingStatusChange={updateDateBookingStatus}
          onVisibleDatesChange={loadVisibleFullyBookedStatuses}
        />
      );
    }

    if (activePage === 'feedbacks') {
      return (
        <Feedbacks
          feedbacks={feedbacks}
          message={feedbacksMessage}
          isLoading={isLoadingFeedbacks}
          onRefresh={async () => {
            await loadFeedbacks();
          }}
        />
      );
    }

    if (activePage === 'reports') {
      return <Reports reservations={allReservations} feedbacks={feedbacks} restaurantLogoUrl={settings.restaurantLogoUrl} restaurantName={settings.restaurantName} />;
    }

    if (activePage === 'shows') {
      return <Shows webhookShows={getClientWebhook('webhook_shows')} />;
    }

    if (activePage === 'settings') {
      return (
        <Settings
          settings={settings}
          restaurantTables={restaurantTables}
          reservableResources={reservableResources}
          tableSyncMessage={tablesSyncMessage}
          resourcesSyncMessage={resourcesSyncMessage}
          isLoadingTables={isLoadingTables}
          isLoadingResources={isLoadingResources}
          isLoadingSettings={isLoadingOperationalSettings}
          settingsMessage={settingsMessage}
          isDemoMode={isSupabaseDemoRoute()}
          isDemoUser={isProtectedDemoUser}
          isSuperAdmin={isSuperAdmin && !isProtectedDemoUser}
          clientId={clientConfig?.client_id ?? ''}
          clientLicense={clientLicense}
          lastUpdatedAt={lastUpdatedAt}
          onRefreshTables={async () => {
            await loadTables();
          }}
          onCreateTable={handleCreateTable}
          onUpdateTable={handleUpdateTable}
          onDeactivateTable={handleDeactivateTable}
          onDeleteTable={handleDeleteTable}
          onRefreshResources={async () => {
            await loadResources();
          }}
          onCreateResource={handleCreateResource}
          onUpdateResource={handleUpdateResource}
          onDeleteResource={handleDeleteResource}
          onSettingsSave={handleSettingsSave}
          onClientLicenseSave={handleClientLicenseSave}
        />
      );
    }

    return (
      <Today
        dayStatus={{
          ...dayStatus,
          bookingsOpen: !isTodayFullyBooked,
          fullyBooked: isTodayFullyBooked,
        }}
        lastSync={lastSync}
        restaurantName={settings.restaurantName}
        restaurantLogoUrl={settings.restaurantLogoUrl}
        openingTime={settings.openingTime}
        closingTime={settings.closingTime}
        bookingInterval={settings.bookingInterval}
        reservations={todayReservations}
        allReservations={allReservations}
        reservableResources={reservableResources}
        serviceTabs={todayTabServices}
        selectedService={selectedTodayService}
        onServiceChange={handleTodayServiceChange}
        tableOptions={activeTableOptions}
        hasLoadedTables={hasLoadedTables}
        isLoadingTables={isLoadingTables}
        totalPax={totalPax}
        arrivals={arrivals}
        occupancyPercent={occupancyPercent}
        totalCapacity={settings.totalCapacity}
        onAddWalkIn={handleAddWalkIn}
        onAddManualReservation={addManualReservation}
        onBookingStatus={handleBookingStatus}
        onUpdateReservation={handleUpdateReservation}
        onEnsureTables={ensureTablesForAssignment}
        onCancelReservation={setReservationToCancel}
        onBalinesePayment={handleBalinesePayment}
        onRefreshReservations={refreshReservationsOnly}
        isRefreshingReservations={isLoadingReservations}
        lastUpdatedAt={lastUpdatedAt}
      />
    );
  }

  if (isPasswordSetupPath()) {
    return <SetPasswordScreen />;
  }

  if (!clientConfig) {
    return <LoginScreen error={loginError} isLoading={isLoggingIn} onLogin={handleLogin} />;
  }

  if (!isSuperAdmin && isInactiveClientLicense(clientLicense)) {
    return (
      <div className="license-blocked-screen">
        <div className="license-blocked-card">
          <BrandLogo fallbackUrl={settings.restaurantLogoUrl || DEFAULT_COSTABOTS_LOGO} fallbackLabel="C" alt={settings.restaurantName} variant="restaurant" />
          <p className="eyebrow">Licencia COSTABOTS</p>
          <h1>Cliente {clientLicense.status === 'EXPIRED' ? 'expirado' : 'suspendido'}</h1>
          <p>
            La licencia de {settings.restaurantName || 'este restaurante'} no esta activa. Contacta con COSTABOTS para reactivar el acceso.
          </p>
          <button className="secondary-button bordered-action" type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <Layout
      activePage={activePage}
      restaurantName={settings.restaurantName}
      restaurantLogoUrl={settings.restaurantLogoUrl}
      isSuperAdmin={isSuperAdmin && !isProtectedDemoUser}
      activeClientId={clientConfig.client_id ?? ''}
      managedClients={availableManagedClients}
      onClientChange={(clientId) => void handleManagedClientChange(clientId)}
      onNavigate={setActivePage}
      onLogout={handleLogout}
    >
      {isDemoClient && <div className="demo-banner">DEMO · Datos simulados</div>}
      {isProtectedDemoUser && <div className="demo-banner">Modo demo: algunas opciones estan bloqueadas.</div>}
      {renderPage()}
      {reservationToCancel && (
        <div className="modal-backdrop" role="presentation" onPointerDown={rejectCancelReservation}>
          <div className="show-modal cancel-modal" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>
            <div className="section-title compact">
              <div>
                <p className="eyebrow">Cancelar reserva</p>
                <h2>{reservationToCancel.service === 'BALINESA' ? '¿Seguro que quieres cancelar esta reserva de balinesa?' : '¿Cancelar esta reserva?'}</h2>
              </div>
            </div>
            <div className="cancel-summary">
              <strong>{reservationToCancel.name || reservationToCancel.room || 'Reserva sin nombre'}</strong>
              <span>{reservationToCancel.date} · {reservationToCancel.time} · {reservationToCancel.pax} pax</span>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={rejectCancelReservation}>
                No, mantener
              </button>
              <button className="danger-button" type="button" onClick={() => void confirmCancelReservation()}>
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function isPasswordSetupPath() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const setupType = params.get('type') || hashParams.get('type');
  const hasImplicitSessionTokens = Boolean(hashParams.get('access_token') || hashParams.get('refresh_token'));
  return window.location.pathname === '/set-password'
    || Boolean(params.get('code'))
    || setupType === 'invite'
    || setupType === 'recovery'
    || hasImplicitSessionTokens;
}

function SetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState<'checking' | 'ready' | 'invalid'>('checking');

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active && nextSession) setAuthStatus('ready');
    });

    async function initializeAuth() {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          if (active) setAuthStatus('invalid');
          return;
        }
      }

      const { data, error } = await supabase.auth.getSession();
      if (!active) return;
      setAuthStatus(!error && Boolean(data.session?.user?.id && data.session.access_token) ? 'ready' : 'invalid');
    }

    void initializeAuth();
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (authStatus !== 'ready') {
      setMessage('El enlace no es válido o ha caducado.');
      return;
    }
    if (password.length < 8 || password !== repeat) {
      setMessage(password.length < 8 ? 'La contraseña debe tener al menos 8 caracteres.' : 'Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    setMessage('');
    const result = await supabase.auth.updateUser({ password });
    if (result.error) {
      console.warn('[AUTH][PASSWORD_SETUP] updateUser failed', { code: result.error.code, status: result.error.status });
      setMessage('No se pudo establecer la contraseña. El enlace puede haber caducado.');
    } else {
      setMessage('Contraseña establecida correctamente. Redirigiendo al login...');
      window.setTimeout(async () => { await supabase.auth.signOut(); window.location.assign('/'); }, 1200);
    }
    setBusy(false);
  }

  return <main className="login-shell"><section className="login-card"><div className="login-brand"><BrandLogo fallbackUrl={DEFAULT_COSTABOTS_LOGO} fallbackLabel="C" alt="COSTABOTS" variant="restaurant" /><span>COSTABOTS Manager</span></div><h1>Establecer contraseña</h1>{authStatus === 'checking' ? <p>Validando enlace...</p> : <><p>{authStatus === 'ready' ? 'Define una contraseña para acceder a tu cuenta.' : 'El enlace no es válido o ha caducado.'}</p><form className="login-form" onSubmit={submit}><label>Nueva contraseña<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={authStatus !== 'ready' || busy} required /></label><label>Repetir contraseña<input type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} disabled={authStatus !== 'ready' || busy} required /></label>{message && <p className="login-error">{message}</p>}<button className="primary-button login-submit" disabled={busy || authStatus !== 'ready'} type="submit">{busy ? 'Guardando...' : 'Guardar contraseña'}</button></form></>}</section></main>;
}

function getPublicFeedbackReservationId() {
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get('id_reserva')?.trim() || params.get('id')?.trim();
  if (queryId) return queryId;

  const match = window.location.pathname.match(/^\/feedback\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function DemoAuthGate() {
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const config = getClientConfig();
    return sessionStorage.getItem(LOGIN_FLAG_KEY) === 'true' && isValidClientConfig(config) && (config.auth_provider === 'supabase' || toSupabaseBoolean(config.IS_DEMO) || toSupabaseBoolean(config.is_demo));
  });

  async function handleDemoLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!isSupabaseConfigured) {
      setError('Supabase no esta configurado');
      return;
    }

    setIsLoading(true);
    clearLoginSession();

    try {
      const authResult = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authResult.error || !authResult.data.user) {
        console.error('[DEMO] Login error:', authResult.error ?? 'No auth user returned');
        setError('Credenciales incorrectas');
        return;
      }

      const userId = authResult.data.user.id;
      let profile: Record<string, unknown> | null = null;
      let client: Record<string, unknown> | null = null;
      let webhooks: Record<string, string> = {};
      let demoSettings: Record<string, unknown> = {};
      let clientId = 'CB-DEMO-001';
      let role = 'demo';

      try {
        const profileResult = await supabase
          .from('PROFILES')
          .select('user_id, client_id, role, status')
          .eq('user_id', userId)
          .maybeSingle();

        if (profileResult.error) {
          console.warn('[DEMO] Profile load warning:', profileResult.error);
        } else {
          profile = profileResult.data as Record<string, unknown> | null;
          if (profile) {
            const profileStatus = pickSupabaseValue(profile, ['status', 'STATUS']).toUpperCase();
            if (profileStatus && profileStatus !== 'ACTIVE') {
              console.warn('[DEMO] Profile inactive, entering demo with fallback config:', profileStatus);
            }
            clientId = pickSupabaseValue(profile, ['client_id']).trim() || clientId;
            role = pickSupabaseValue(profile, ['role', 'ROLE']) || role;
          } else {
            console.warn('[DEMO] Profile not found, entering demo with fallback config');
          }
        }
        console.log('[DEMO] Supabase profile loaded', profile);
      } catch (profileError) {
        console.warn('[DEMO] Profile load warning:', profileError);
      }

      try {
        const { data: clientData, error: clientError } = await supabase
          .from('CLIENTES')
          .select('*')
          .eq('client_id', clientId.trim())
          .maybeSingle();

        if (clientError) {
          console.warn('[DEMO] Client load warning:', clientError);
        } else {
          client = clientData as Record<string, unknown> | null;
          if (!client) {
            console.warn('[DEMO] Client not found, entering demo with fallback config');
          }
        }
      } catch (clientLoadError) {
        console.warn('[DEMO] Client load warning:', clientLoadError);
      }

      try {
        const { data, error } = await supabase
          .from('WEBHOOKS')
          .select('*');

        console.log('[DEMO DEBUG] WEBHOOKS data:', data);
        console.log('[DEMO DEBUG] WEBHOOKS error:', error);
        console.log('[DEMO DEBUG] WEBHOOKS keys:', data?.[0] ? Object.keys(data[0]) : 'NO_ROWS');

        if (error) {
          console.warn('[DEMO] Webhooks load warning:', error);
        } else {
          const globalWebhooks: Record<string, string> = {};

          (data || []).forEach((row: Record<string, unknown>) => {
            const active = row.ACTIVO ?? row.activo;
            const action = row.TIPO_ACCION ?? row.tipo_accion;
            const url = row.URL_WEBHOOK ?? row.url_webhook;
            console.log('[DEMO DEBUG] webhook row parsed:', { active, action, url, row });
            if ((active === true || active === 'true' || active === 'TRUE') && action && url) {
              globalWebhooks[String(action)] = String(url);
            }
          });

          webhooks = {
            ...globalWebhooks,
            getReservas: globalWebhooks.RESERVATION_LIST || '',
            reservas: globalWebhooks.RESERVATION_CREATE || '',
            getMesas: globalWebhooks.TABLES_LIST || '',
            saveMesa: globalWebhooks.TABLE_SAVE || '',
            getFeedbacks: globalWebhooks.FEEDBACK_LIST || globalWebhooks.FEEDBACK_CREATE || '',
            feedbacks: globalWebhooks.FEEDBACK_CREATE || '',
            settings: globalWebhooks.SETTINGS_UPDATE || '',
            getCapacidad: globalWebhooks.CAPACITY_LIST || '',
            saveCapacidad: globalWebhooks.CAPACITY_SAVE || '',
          };
          console.log('[DEMO] Raw WEBHOOKS rows', data);
          console.log('[DEMO] globalWebhooks', globalWebhooks);
          console.log('[DEMO DEBUG] globalWebhooks final:', globalWebhooks);
        }
        console.log('[DEMO] Parsed webhooks:', webhooks);
        console.log('[DEMO] Webhooks loaded', webhooks);
      } catch (webhooksLoadError) {
        console.warn('[DEMO] Webhooks load warning:', webhooksLoadError);
      }

      try {
        const { data: settingsRows, error: settingsError } = await supabase
          .from('SETTINGS')
          .select('*')
          .eq('client_id', clientId);

        if (settingsError) {
          console.warn('[DEMO] Settings load warning:', settingsError);
        } else {
          demoSettings = normalizeDemoSettings((settingsRows ?? []) as Array<Record<string, unknown>>);
        }
        console.log('[DEMO] Settings loaded', demoSettings);
      } catch (settingsLoadError) {
        console.warn('[DEMO] Settings load warning:', settingsLoadError);
      }

      const config = normalizeClientConfig({
        success: true,
        auth_provider: 'supabase',
        client_id: clientId,
        rest_nombre: pickSupabaseValue(client, ['rest_name']) || 'Demo Restaurant',
        logo_restaurante: pickSupabaseValue(client, ['logo_url']),
        color: pickSupabaseValue(client, ['primary_color']),
        sheet_id: pickSupabaseValue(client, ['sheet_id']),
        role,
        status: normalizeClientLicenseStatus(pickSupabaseValue(client, ['status', 'STATUS'])),
        plan: normalizeClientLicensePlan(pickSupabaseValue(client, ['plan', 'PLAN'])),
        expires_at: pickSupabaseValue(client, ['expires_at', 'EXPIRES_AT', 'expiresAt']),
        licenseStatus: normalizeClientLicenseStatus(pickSupabaseValue(client, ['status', 'STATUS'])),
        licensePlan: normalizeClientLicensePlan(pickSupabaseValue(client, ['plan', 'PLAN'])),
        licenseExpiresAt: pickSupabaseValue(client, ['expires_at', 'EXPIRES_AT', 'expiresAt']),
        IS_DEMO: true,
        is_demo: true,
        settings: demoSettings,
        webhooks,
        webhooksLegacy: {
          getReservas: webhooks.RESERVATION_LIST || '',
          reservas: webhooks.RESERVATION_CREATE || '',
          getMesas: webhooks.TABLES_LIST || '',
          saveMesa: webhooks.TABLE_SAVE || '',
          getFeedbacks: webhooks.FEEDBACK_LIST || webhooks.FEEDBACK_CREATE || '',
          feedbacks: webhooks.FEEDBACK_CREATE || '',
          settings: webhooks.SETTINGS_UPDATE || '',
          getCapacidad: webhooks.CAPACITY_LIST || '',
          saveCapacidad: webhooks.CAPACITY_SAVE || '',
        },
        webhookReservas: webhooks.RESERVATION_CREATE,
        webhook_reservas: webhooks.RESERVATION_CREATE || '',
        webhook_manual: webhooks.RESERVATION_CREATE,
        webhookLeerReservas: webhooks.RESERVATION_LIST,
        webhook_get_reservas: webhooks.RESERVATION_LIST,
        webhookCancelarReserva: webhooks.RESERVATION_CANCEL,
        webhookCancelReservationUrl: webhooks.RESERVATION_CANCEL,
        webhook_cancel: webhooks.RESERVATION_CANCEL,
        webhookWalkin: webhooks.WALKIN_CREATE,
        webhook_walkin: webhooks.WALKIN_CREATE,
        webhookLlegada: webhooks.ARRIVAL_UPDATE,
        webhook_arrived: webhooks.ARRIVAL_UPDATE,
        webhookMesa: webhooks.TABLE_ASSIGN,
        webhook_mesa: webhooks.TABLE_ASSIGN,
        webhookFullyBooked: webhooks.FULLY_BOOKED,
        webhook_fully_booked: webhooks.FULLY_BOOKED,
        webhookLeerMesas: webhooks.TABLES_LIST,
        webhookGetMesas: webhooks.TABLES_LIST,
        webhook_get_mesas: webhooks.TABLES_LIST,
        webhookGuardarMesa: webhooks.TABLE_SAVE,
        webhookSaveMesa: webhooks.TABLE_SAVE,
        webhook_save_mesa: webhooks.TABLE_SAVE,
        webhookLeerCapacidad: webhooks.CAPACITY_LIST,
        webhookGetCapacidad: webhooks.CAPACITY_LIST,
        webhook_get_capacidad: webhooks.CAPACITY_LIST,
        webhookGuardarCapacidad: webhooks.CAPACITY_SAVE,
        webhookSettingsCapacityUrl: webhooks.CAPACITY_SAVE,
        webhook_capacidad: webhooks.CAPACITY_SAVE,
        webhookShows: webhooks.SHOWS_UPDATE,
        webhook_shows: webhooks.SHOWS_UPDATE,
        webhookFeedbacks: webhooks.FEEDBACK_CREATE,
        webhook_feedbacks: webhooks.FEEDBACK_CREATE,
        webhookSettings: webhooks.SETTINGS_UPDATE,
        webhook_settings: webhooks.SETTINGS_UPDATE,
      });
      console.log('[DEMO] Supabase profile loaded', profile);
      console.log('[DEMO] Client config loaded', config);

      if (!isValidClientConfig(config)) {
        console.warn('[DEMO] Client config warning: invalid config after normalization, entering with demo fallback');
      }

      console.log('[DEMO] config final with legacy aliases', config);
      console.log('[DEMO DEBUG] config before sessionStorage:', config);
      sessionStorage.setItem(CLIENT_CONFIG_KEY, JSON.stringify(config));
      sessionStorage.setItem(LOGIN_FLAG_KEY, 'true');
      console.log('[DEMO DEBUG] sessionStorage saved:', JSON.parse(sessionStorage.getItem('costabots_client_config') || 'null'));
      console.log('Cliente demo cargado:', config.rest_nombre);
      setIsAuthenticated(true);
    } catch (loginError) {
      console.error('[DEMO] Login error:', loginError);
      setError('Credenciales incorrectas');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDemoLogout() {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
  }

  if (isAuthenticated) {
    return <ManagerApp onLogoutComplete={handleDemoLogout} />;
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-label="Acceso demo CostaBots Manager">
        <div className="login-brand">
          <BrandLogo fallbackUrl={DEFAULT_COSTABOTS_LOGO} fallbackLabel="C" alt="Costabots" variant="platform" preferFallback />
          <div>
            <p className="eyebrow">Acceso demo</p>
            <h1>CostaBots Manager</h1>
          </div>
        </div>

        <form className="login-form" onSubmit={handleDemoLogin}>
          <label>
            Email
            <input autoComplete="email" autoFocus name="email" onChange={(event) => setEmail(event.target.value)} placeholder="email@restaurante.com" required type="email" value={email} />
          </label>

          <label>
            Password
            <input autoComplete="current-password" name="password" onChange={(event) => setPassword(event.target.value)} placeholder="Password" required type="password" value={password} />
          </label>

          {error && <p className="login-error">{error}</p>}

          <button className="primary-button login-submit" disabled={isLoading} type="submit">
            {isLoading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

export function App() {
  const feedbackReservationId = getPublicFeedbackReservationId();

  if (feedbackReservationId) {
    console.log('[FeedbackPublic render]', feedbackReservationId);
    return <FeedbackPublic idReserva={feedbackReservationId} />;
  }

  if (window.location.pathname.toLowerCase() === '/demo') {
    return <DemoAuthGate />;
  }

  return <ManagerApp />;
}

