import { mockSettings } from '../mock';
import type { ManagerSettings } from '../types';

export const LOGIN_FLAG_KEY = 'costabots_logged_in';
export const CLIENT_CONFIG_KEY = 'costabots_client_config';

export type ClientWebhookKey =
  | 'webhook_get_reservas'
  | 'webhook_reservas'
  | 'webhook_walkin'
  | 'webhook_manual'
  | 'webhook_arrived'
  | 'webhook_mesa'
  | 'webhook_fully_booked'
  | 'webhook_cancel'
  | 'webhook_settings'
  | 'webhook_get_capacidad'
  | 'webhook_capacidad'
  | 'webhook_get_mesas'
  | 'webhook_save_mesa'
  | 'webhook_shows'
  | 'webhook_feedbacks';

export interface ClientWebhooks {
  webhookReservas?: string;
  webhookWalkin?: string;
  webhookLlegada?: string;
  webhookMesa?: string;
  webhookFullyBooked?: string;
  webhookLeerReservas?: string;
  webhookCancelReservationUrl?: string;
  webhookGetMesas?: string;
  webhookSaveMesa?: string;
  webhookGetCapacidad?: string;
  webhookSettingsCapacityUrl?: string;
  webhookShows?: string;
  webhookFeedbacks?: string;
  webhookSettings?: string;
  getMesas?: string;
  saveMesa?: string;
  getFeedbacks?: string;
  feedbacks?: string;
  [key: string]: unknown;
}

export interface ExternalClientConfig {
  success?: boolean;
  clientId?: string;
  client_id?: string;
  rest_nombre?: string;
  rest_name?: string;
  restaurantName?: string;
  restaurantLogoUrl?: string;
  logo_url?: string;
  primaryColor?: string;
  primary_color?: string;
  googleSheetId?: string;
  sheet_id?: string;
  logo_costabots?: string;
  logo_restaurante?: string;
  color?: string;
  webhook_get_reservas?: string;
  webhook_reservas?: string;
  webhook_walkin?: string;
  webhook_manual?: string;
  webhook_arrived?: string;
  webhook_mesa?: string;
  webhook_fully_booked?: string;
  webhook_cancel?: string;
  webhook_settings?: string;
  webhookSettings?: string;
  webhook_get_capacidad?: string;
  WEBHOOK_GET_CAPACIDAD?: string;
  webhookGetCapacidad?: string;
  webhookGetCapacity?: string;
  webhook_get_capacity?: string;
  webhook_capacidad?: string;
  webhook_settings_capacidad?: string;
  webhookSettingsCapacityUrl?: string;
  webhook_capacidad_settings?: string;
  webhook_get_mesas?: string;
  webhook_save_mesa?: string;
  webhook_leer_mesas?: string;
  webhook_guardar_mesas?: string;
  webhook_shows?: string;
  webhook_feedbacks?: string;
  webhook_leer_feedbacks?: string;
  webhooks?: ClientWebhooks;
  [key: string]: unknown;
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickClientWebhook(config: ExternalClientConfig | null, key: ClientWebhookKey) {
  const isDemoRoute = typeof window !== 'undefined' && window.location.pathname.includes('/demo');
  const directValue = toStringValue(config?.[key]);
  if (directValue) {
    return directValue;
  }

  const webhooks = (config?.webhooks ?? {}) as Record<string, unknown>;
  const aliases: Record<ClientWebhookKey, string[]> = {
    webhook_get_reservas: ['RESERVATION_LIST', 'webhookLeerReservas', 'getReservas', 'getReservations'],
    webhook_reservas: ['RESERVATION_CREATE', 'webhookReservas', 'reservas', 'manual'],
    webhook_walkin: ['WALKIN_CREATE', 'webhookWalkin', 'walkin'],
    webhook_manual: ['RESERVATION_CREATE', 'webhookReservas', 'manual', 'reservas'],
    webhook_arrived: ['ARRIVAL_UPDATE', 'webhookLlegada', 'arrived', 'llegada'],
    webhook_mesa: ['TABLE_ASSIGN', 'webhookMesa', 'mesa'],
    webhook_fully_booked: ['FULLY_BOOKED', 'webhookFullyBooked', 'fullyBooked'],
    webhook_cancel: ['RESERVATION_CANCEL', 'webhookCancelReservationUrl', 'cancel', 'cancelReservation'],
    webhook_settings: ['SETTINGS_UPDATE', 'webhookSettings', 'settings'],
    webhook_get_capacidad: ['CAPACITY_LIST', 'WEBHOOK_GET_CAPACIDAD', 'webhookGetCapacidad', 'webhookGetCapacity', 'webhook_get_capacity', 'getCapacity', 'getCapacityWebhook', 'webhookCapacityGetUrl'],
    webhook_capacidad: ['CAPACITY_SAVE', 'WEBHOOK_CAPACIDAD', 'webhookCapacity', 'webhookSettingsCapacityUrl', 'webhook_settings_capacidad', 'webhook_capacidad_settings', 'settingsCapacity', 'capacitySettings'],
    webhook_get_mesas: ['TABLES_LIST', 'webhook_leer_mesas', 'WEBHOOK_LEER_MESAS', 'webhookLeerMesas', 'webhookGetMesas', 'getMesas', 'tablesGet'],
    webhook_save_mesa: ['TABLE_SAVE', 'webhook_guardar_mesas', 'WEBHOOK_GUARDAR_MESAS', 'webhookGuardarMesas', 'webhookSaveMesa', 'saveMesa', 'tablesSave'],
    webhook_shows: ['SHOWS_UPDATE', 'webhookShows', 'shows'],
    webhook_feedbacks: ['FEEDBACK_CREATE', 'webhook_leer_feedbacks', 'WEBHOOK_LEER_FEEDBACKS', 'webhookLeerFeedbacks', 'webhookFeedbacks', 'getFeedbacks', 'feedbacks'],
  };

  for (const alias of aliases[key]) {
    const value = toStringValue(webhooks[alias] ?? config?.[alias]);
    if (value) {
      return value;
    }
  }

  if (isDemoRoute) {
    console.log('[DEMO DEBUG] resolve webhook', {
      key,
      configWebhooks: config?.webhooks,
      value: '',
    });
  }

  return '';
}

export function normalizeClientConfig(config: ExternalClientConfig): ExternalClientConfig {
  const getMesas = pickClientWebhook(config, 'webhook_get_mesas');
  const saveMesa = pickClientWebhook(config, 'webhook_save_mesa');
  const getFeedbacks = pickClientWebhook(config, 'webhook_feedbacks');
  const settings = pickClientWebhook(config, 'webhook_settings');
  const rawGetCapacidad = toStringValue(
    config.WEBHOOK_GET_CAPACIDAD ??
      config.webhook_get_capacidad ??
      config.webhookGetCapacidad ??
      config.webhook_get_capacity ??
      config.webhookGetCapacity ??
      config.webhookCapacityGetUrl ??
      config.getCapacityWebhook ??
      config.getCapacity,
  );
  const getCapacidad = pickClientWebhook(config, 'webhook_get_capacidad');
  const saveCapacidad = pickClientWebhook(config, 'webhook_capacidad');
  console.log('WEBHOOK_GET_CAPACIDAD desde MASTER:', rawGetCapacidad);
  console.log('Cliente config webhookGetCapacidad:', getCapacidad);

  return {
    ...config,
    webhook_settings: settings,
    webhook_get_capacidad: getCapacidad,
    webhookGetCapacidad: getCapacidad,
    webhook_capacidad: saveCapacidad,
    webhook_get_mesas: getMesas,
    webhook_save_mesa: saveMesa,
    webhook_feedbacks: getFeedbacks,
    webhooks: {
      ...(config.webhooks ?? {}),
      getMesas,
      saveMesa,
      getFeedbacks,
      feedbacks: getFeedbacks,
      settings,
      getCapacidad,
      getCapacity: getCapacidad,
      saveCapacidad,
      capacitySettings: saveCapacidad,
    },
  };
}

export function getClientConfig(): ExternalClientConfig | null {
  try {
    const rawConfig = sessionStorage.getItem(CLIENT_CONFIG_KEY);

    if (!rawConfig) {
      return null;
    }

    return normalizeClientConfig(JSON.parse(rawConfig) as ExternalClientConfig);
  } catch {
    return null;
  }
}

export function isValidClientConfig(config: ExternalClientConfig | null): config is ExternalClientConfig {
  return Boolean(
      config &&
      config.success === true &&
      toStringValue(config.client_id ?? config.clientId) &&
      toStringValue(config.rest_nombre ?? config.rest_name ?? config.restaurantName),
  );
}

export function getClientWebhook(key: ClientWebhookKey) {
  const config = getClientConfig();
  const dynamicUrl = pickClientWebhook(config, key);

  if (dynamicUrl) {
    console.log('Usando webhook dinámico:', key);
    return dynamicUrl;
  }

  console.warn(`Webhook dinámico no configurado: ${key}. Usando fallback.`);
  return '';
}

export function getClientSheetId() {
  const config = getClientConfig();
  return toStringValue(config?.sheet_id);
}

export function populateAdminFromClientConfig(
  settings: ManagerSettings,
  config: ExternalClientConfig | null = getClientConfig(),
): ManagerSettings {
  if (!config) {
    return settings;
  }

  return {
    ...settings,
    restaurantName: toStringValue(config.rest_nombre ?? config.rest_name ?? config.restaurantName) || settings.restaurantName || mockSettings.restaurantName,
    costabotsLogoUrl: toStringValue(config.logo_costabots) || settings.costabotsLogoUrl || mockSettings.costabotsLogoUrl,
    restaurantLogoUrl: toStringValue(config.logo_restaurante ?? config.logo_url ?? config.restaurantLogoUrl) || settings.restaurantLogoUrl || mockSettings.restaurantLogoUrl,
    primaryColor: toStringValue(config.color ?? config.primary_color ?? config.primaryColor) || settings.primaryColor || mockSettings.primaryColor,
    googleSheetId: toStringValue(config.sheet_id ?? config.googleSheetId) || settings.googleSheetId || mockSettings.googleSheetId,
    webhookLeerReservas: toStringValue(config.webhook_get_reservas) || settings.webhookLeerReservas || mockSettings.webhookLeerReservas,
    webhookWalkin: toStringValue(config.webhook_walkin) || settings.webhookWalkin || mockSettings.webhookWalkin,
    webhookReservas: toStringValue(config.webhook_manual) || settings.webhookReservas || mockSettings.webhookReservas,
    webhookLlegada: toStringValue(config.webhook_arrived) || settings.webhookLlegada || mockSettings.webhookLlegada,
    webhookMesa: toStringValue(config.webhook_mesa) || settings.webhookMesa || mockSettings.webhookMesa,
    webhookFullyBooked: toStringValue(config.webhook_fully_booked) || settings.webhookFullyBooked || mockSettings.webhookFullyBooked,
    webhookCancelReservationUrl: toStringValue(config.webhook_cancel) || settings.webhookCancelReservationUrl || mockSettings.webhookCancelReservationUrl,
    webhookGetMesas: pickClientWebhook(config, 'webhook_get_mesas') || settings.webhookGetMesas || mockSettings.webhookGetMesas,
    webhookSaveMesa: pickClientWebhook(config, 'webhook_save_mesa') || settings.webhookSaveMesa || mockSettings.webhookSaveMesa,
    webhookSettings: pickClientWebhook(config, 'webhook_settings') || settings.webhookSettings || mockSettings.webhookSettings,
    webhookGetCapacidad: pickClientWebhook(config, 'webhook_get_capacidad') || settings.webhookGetCapacidad || mockSettings.webhookGetCapacidad,
    webhookSettingsCapacityUrl: pickClientWebhook(config, 'webhook_capacidad') || settings.webhookSettingsCapacityUrl || mockSettings.webhookSettingsCapacityUrl,
    webhookShows: toStringValue(config.webhook_shows) || settings.webhookShows || mockSettings.webhookShows,
    webhookFeedbacks: pickClientWebhook(config, 'webhook_feedbacks') || settings.webhookFeedbacks || mockSettings.webhookFeedbacks,
    reservationsWebhook: '',
    walkInWebhook: '',
    feedbacksWebhook: '',
    showsWebhook: '',
  };
}

export function applyExternalClientConfig(settings: ManagerSettings, config: ExternalClientConfig): ManagerSettings {
  return populateAdminFromClientConfig(settings, config);
}
