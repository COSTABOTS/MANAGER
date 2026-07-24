import type { BookingService, ManagerSettings, Weekday } from '../types';
import { invokeManagerApi } from './managerApiClient';

type SettingsRow = Record<string, unknown>;
type SettingsValueMap = Record<string, unknown>;

interface SettingsResponse {
  ok?: boolean;
  success?: boolean;
  settings?: SettingsValueMap | SettingsRow[];
}

const DEFAULT_OPERATIONAL_SETTINGS = {
  BOOKINGS_ENABLED: true,
  MAX_CAPACITY: 60,
  MAX_PAX_PER_BOOKING: 10,
  WHATSAPP_CONFIRMATION: true,
  WHATSAPP_PRE_DINNER_ENABLED: false,
  WHATSAPP_PRE_DINNER_MINUTES: 120,
  POST_DINNER_MESSAGE_ENABLED: false,
  POST_DINNER_MESSAGE_TIME: '12:30',
  FEEDBACK_ALERT_PHONE: '',
  SERVICES_ENABLED: ['CENA'] as BookingService[],
  DESAYUNO_START: '08:00',
  DESAYUNO_END: '10:30',
  ALMUERZO_START: '12:00',
  ALMUERZO_END: '16:00',
  CENA_START: '18:00',
  CENA_END: '21:30',
  OPENING_TIME: '18:00',
  CLOSING_TIME: '21:30',
  BOOKING_INTERVAL: 30,
  OPEN_MONDAY: true,
  OPEN_TUESDAY: true,
  OPEN_WEDNESDAY: true,
  OPEN_THURSDAY: true,
  OPEN_FRIDAY: true,
  OPEN_SATURDAY: true,
  OPEN_SUNDAY: true,
};

const WEEKDAY_KEYS: Array<{ settingKey: keyof typeof DEFAULT_OPERATIONAL_SETTINGS; appKey: Weekday }> = [
  { settingKey: 'OPEN_MONDAY', appKey: 'monday' },
  { settingKey: 'OPEN_TUESDAY', appKey: 'tuesday' },
  { settingKey: 'OPEN_WEDNESDAY', appKey: 'wednesday' },
  { settingKey: 'OPEN_THURSDAY', appKey: 'thursday' },
  { settingKey: 'OPEN_FRIDAY', appKey: 'friday' },
  { settingKey: 'OPEN_SATURDAY', appKey: 'saturday' },
  { settingKey: 'OPEN_SUNDAY', appKey: 'sunday' },
];

function unwrapValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => item !== undefined && item !== null && item !== '') ?? '';
  }

  return value;
}

function toStringValue(value: unknown) {
  const unwrappedValue = unwrapValue(value);
  return unwrappedValue === undefined || unwrappedValue === null ? '' : String(unwrappedValue).trim();
}

function toBooleanValue(value: unknown, fallback: boolean) {
  const normalized = toStringValue(value).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (['true', '1', 'si', 'sí', 'yes', 'y', 'on', 'verdadero'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off', 'falso'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function toNumberValue(value: unknown, fallback: number) {
  const numberValue = Number(toStringValue(value).replace(',', '.'));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizePreDinnerMinutes(value: unknown, fallback: number) {
  const rawValue = toStringValue(value);
  const numberValue = Number(rawValue);

  if (!/^\d+$/.test(rawValue) || !Number.isInteger(numberValue) || numberValue < 15 || numberValue > 1440) {
    return fallback;
  }

  return numberValue;
}

function normalizeTimeValue(value: unknown, fallback: string) {
  const rawValue = toStringValue(value);
  const timeMatch = rawValue.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

  if (!timeMatch) {
    return fallback;
  }

  const [, hours, minutes] = timeMatch;
  const hourNumber = Number(hours);
  const minuteNumber = Number(minutes);

  if (!Number.isInteger(hourNumber) || !Number.isInteger(minuteNumber) || hourNumber < 0 || hourNumber > 23 || minuteNumber < 0 || minuteNumber > 59) {
    return fallback;
  }

  return `${String(hourNumber).padStart(2, '0')}:${String(minuteNumber).padStart(2, '0')}`;
}

function toServicesEnabled(value: unknown, fallback: BookingService[]) {
  const allowedServices: BookingService[] = ['DESAYUNO', 'ALMUERZO', 'CENA', 'BALINESA'];
  const items = Array.isArray(value)
    ? value
    : toStringValue(unwrapValue(value))
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean);
  const services = items
    .map((item) => String(item).trim().toUpperCase())
    .filter((item): item is BookingService => allowedServices.includes(item as BookingService));

  return services.length > 0 ? services : fallback;
}

function getRowValue(row: SettingsRow, keys: string[]) {
  for (const key of keys) {
    const value = unwrapValue(row[key]);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return '';
}

function normalizeSettingsMap(settings: SettingsValueMap | SettingsRow[] | undefined): SettingsValueMap {
  if (!settings) {
    return {};
  }

  if (!Array.isArray(settings)) {
    return settings;
  }

  return settings.reduce<SettingsValueMap>((items, row) => {
    const key = toStringValue(getRowValue(row, ['VARIABLE', 'variable', 'key', 'KEY', '0']));
    const value = getRowValue(row, ['VALUE', 'value', 'VALOR', 'valor', '1']);

    if (key) {
      items[key] = value;
    }

    return items;
  }, {});
}

function toSaveValue(value: boolean | number | string) {
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  return String(value);
}

export function buildOperationalSettingsPayload(settings: ManagerSettings) {
  const settingsMap = {
    BOOKINGS_ENABLED: settings.reservasActivas,
    MAX_CAPACITY: settings.totalCapacity,
    MAX_PAX_PER_BOOKING: settings.maxPaxPerBooking,
    WHATSAPP_CONFIRMATION: settings.whatsappConfirmation,
    WHATSAPP_PRE_DINNER_ENABLED: settings.whatsappPreCena,
    WHATSAPP_PRE_DINNER_MINUTES: normalizePreDinnerMinutes(settings.whatsappPreCenaMinutes, DEFAULT_OPERATIONAL_SETTINGS.WHATSAPP_PRE_DINNER_MINUTES),
    POST_DINNER_MESSAGE_ENABLED: settings.mensajePostCena,
    POST_DINNER_MESSAGE_TIME: normalizeTimeValue(settings.mensajePostCenaHora, DEFAULT_OPERATIONAL_SETTINGS.POST_DINNER_MESSAGE_TIME),
    FEEDBACK_ALERT_PHONE: settings.feedbackAlertPhone,
    SERVICES_ENABLED: (settings.servicesEnabled.length > 0 ? settings.servicesEnabled : ['CENA']).join(','),
    DESAYUNO_START: settings.serviceHours.DESAYUNO.start,
    DESAYUNO_END: settings.serviceHours.DESAYUNO.end,
    ALMUERZO_START: settings.serviceHours.ALMUERZO.start,
    ALMUERZO_END: settings.serviceHours.ALMUERZO.end,
    CENA_START: settings.serviceHours.CENA.start,
    CENA_END: settings.serviceHours.CENA.end,
    OPENING_TIME: settings.openingTime,
    CLOSING_TIME: settings.closingTime,
    BOOKING_INTERVAL: settings.bookingInterval,
    OPEN_MONDAY: settings.openingDays.monday,
    OPEN_TUESDAY: settings.openingDays.tuesday,
    OPEN_WEDNESDAY: settings.openingDays.wednesday,
    OPEN_THURSDAY: settings.openingDays.thursday,
    OPEN_FRIDAY: settings.openingDays.friday,
    OPEN_SATURDAY: settings.openingDays.saturday,
    OPEN_SUNDAY: settings.openingDays.sunday,
  };

  return Object.entries(settingsMap).map(([variable, value]) => ({
    variable,
    value: toSaveValue(value),
  }));
}

export function applyOperationalSettings(currentSettings: ManagerSettings, rawSettings: SettingsValueMap | SettingsRow[] | undefined): ManagerSettings {
  const settingsMap = {
    ...DEFAULT_OPERATIONAL_SETTINGS,
    ...normalizeSettingsMap(rawSettings),
  };
  const openingDays = { ...currentSettings.openingDays };

  WEEKDAY_KEYS.forEach(({ settingKey, appKey }) => {
    openingDays[appKey] = toBooleanValue(settingsMap[settingKey], DEFAULT_OPERATIONAL_SETTINGS[settingKey] as boolean);
  });

  const servicesEnabledSetting = (settingsMap as SettingsValueMap).SERVICES_ENABLED ?? (settingsMap as SettingsValueMap).services_enabled;
  const normalizedSettings: ManagerSettings = {
    ...currentSettings,
    reservasActivas: toBooleanValue(settingsMap.BOOKINGS_ENABLED, DEFAULT_OPERATIONAL_SETTINGS.BOOKINGS_ENABLED),
    totalCapacity: toNumberValue(settingsMap.MAX_CAPACITY, DEFAULT_OPERATIONAL_SETTINGS.MAX_CAPACITY),
    maxPaxPerBooking: toNumberValue(settingsMap.MAX_PAX_PER_BOOKING, DEFAULT_OPERATIONAL_SETTINGS.MAX_PAX_PER_BOOKING),
    whatsappConfirmation: toBooleanValue(settingsMap.WHATSAPP_CONFIRMATION, DEFAULT_OPERATIONAL_SETTINGS.WHATSAPP_CONFIRMATION),
    whatsappPreCena: toBooleanValue(settingsMap.WHATSAPP_PRE_DINNER_ENABLED, DEFAULT_OPERATIONAL_SETTINGS.WHATSAPP_PRE_DINNER_ENABLED),
    whatsappPreCenaMinutes: normalizePreDinnerMinutes(settingsMap.WHATSAPP_PRE_DINNER_MINUTES, DEFAULT_OPERATIONAL_SETTINGS.WHATSAPP_PRE_DINNER_MINUTES),
    mensajePostCena: toBooleanValue(settingsMap.POST_DINNER_MESSAGE_ENABLED, DEFAULT_OPERATIONAL_SETTINGS.POST_DINNER_MESSAGE_ENABLED),
    mensajePostCenaHora: normalizeTimeValue(settingsMap.POST_DINNER_MESSAGE_TIME, DEFAULT_OPERATIONAL_SETTINGS.POST_DINNER_MESSAGE_TIME),
    feedbackAlertPhone: toStringValue(settingsMap.FEEDBACK_ALERT_PHONE),
    servicesEnabled: toServicesEnabled(servicesEnabledSetting, DEFAULT_OPERATIONAL_SETTINGS.SERVICES_ENABLED),
    serviceHours: {
      DESAYUNO: {
        start: normalizeTimeValue(settingsMap.DESAYUNO_START, DEFAULT_OPERATIONAL_SETTINGS.DESAYUNO_START),
        end: normalizeTimeValue(settingsMap.DESAYUNO_END, DEFAULT_OPERATIONAL_SETTINGS.DESAYUNO_END),
      },
      ALMUERZO: {
        start: normalizeTimeValue(settingsMap.ALMUERZO_START, DEFAULT_OPERATIONAL_SETTINGS.ALMUERZO_START),
        end: normalizeTimeValue(settingsMap.ALMUERZO_END, DEFAULT_OPERATIONAL_SETTINGS.ALMUERZO_END),
      },
      CENA: {
        start: normalizeTimeValue(settingsMap.CENA_START, DEFAULT_OPERATIONAL_SETTINGS.CENA_START),
        end: normalizeTimeValue(settingsMap.CENA_END, DEFAULT_OPERATIONAL_SETTINGS.CENA_END),
      },
    },
    openingTime: toStringValue(settingsMap.OPENING_TIME) || DEFAULT_OPERATIONAL_SETTINGS.OPENING_TIME,
    closingTime: toStringValue(settingsMap.CLOSING_TIME) || DEFAULT_OPERATIONAL_SETTINGS.CLOSING_TIME,
    bookingInterval: toNumberValue(settingsMap.BOOKING_INTERVAL, DEFAULT_OPERATIONAL_SETTINGS.BOOKING_INTERVAL) === 60 ? 60 : 30,
    openingDays,
  };

  console.log('SETTINGS cargados normalizados', normalizedSettings);
  return normalizedSettings;
}

export function applyOperationalDefaults(currentSettings: ManagerSettings) {
  return applyOperationalSettings(currentSettings, DEFAULT_OPERATIONAL_SETTINGS);
}

export async function loadOperationalSettings(webhookUrl: string): Promise<SettingsValueMap | SettingsRow[]> {
  if (!webhookUrl.trim()) {
    throw new Error('Webhook SETTINGS no configurado');
  }

  console.log('SETTINGS webhook URL usada', webhookUrl);

  const response = await fetch(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_settings' }),
  });

  if (!response.ok) {
    throw new Error(`No se pudieron cargar SETTINGS (${response.status})`);
  }

  const data = (await response.json()) as SettingsResponse;
  console.log('SETTINGS recibidos crudos', data);
  if (data.ok === false || data.success === false) {
    throw new Error('Respuesta SETTINGS no valida');
  }

  return data.settings ?? DEFAULT_OPERATIONAL_SETTINGS;
}

export async function loadOperationalSettingsFromManagerApi(): Promise<SettingsValueMap | SettingsRow[]> {
  console.log('[DEMO][MANAGER_API] calling settings.get');

  const data = await invokeManagerApi<SettingsResponse & { code?: string; message?: string }>({ action: 'settings.get' });

  const response = data as SettingsResponse & { code?: string; message?: string };

  if (!response?.ok) {
    throw new Error(response?.code || response?.message || 'manager-api settings.get no devolvio ok=true');
  }

  console.log('[DEMO][MANAGER_API] settings received', response.settings);

  return response.settings ?? DEFAULT_OPERATIONAL_SETTINGS;
}

export async function saveOperationalSettings(webhookUrl: string, settings: ManagerSettings) {
  if (!webhookUrl.trim()) {
    throw new Error('Webhook SETTINGS no configurado');
  }

  console.log('SETTINGS webhook URL usada', webhookUrl);
  const payload = buildOperationalSettingsPayload(settings);
  console.log('Payload save_settings enviado:', payload);

  const response = await fetch(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'save_settings',
      settings: payload,
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudieron guardar SETTINGS (${response.status})`);
  }

  const data = (await response.json().catch(() => ({ ok: true }))) as SettingsResponse;
  if (data.ok === false || data.success === false) {
    throw new Error('Respuesta SETTINGS no valida');
  }

  return data;
}

export async function saveOperationalSettingsWithManagerApi(settings: ManagerSettings) {
  const settingsPayload = buildOperationalSettingsPayload(settings).reduce<Record<string, string>>((items, item) => {
    items[item.variable] = item.value;
    return items;
  }, {});

  const data = await invokeManagerApi<SettingsResponse & { code?: string; message?: string }>({
    action: 'settings.save',
    settings: settingsPayload,
  });

  const response = data as SettingsResponse & { code?: string; message?: string };
  if (!response?.ok) {
    throw new Error(response?.code || response?.message || 'manager-api settings.save no devolvio ok=true');
  }

  console.log('[DEMO][SETTINGS] saved by manager-api');
  return response;
}
