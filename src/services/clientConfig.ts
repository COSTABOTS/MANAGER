import { mockSettings } from '../mock';
import type { ManagerSettings } from '../types';

export const LOGIN_FLAG_KEY = 'costabots_logged_in';
export const CLIENT_CONFIG_KEY = 'costabots_client_config';

export type ClientWebhookKey =
  | 'webhook_get_reservas'
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
  restaurantName?: string;
  restaurantLogoUrl?: string;
  primaryColor?: string;
  googleSheetId?: string;
  sheet_id?: string;
  logo_costabots?: string;
  logo_restaurante?: string;
  color?: string;
  webhook_get_reservas?: string;
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
  const directValue = toStringValue(config?.[key]);
  if (directValue) {
    return directValue;
  }

  const webhooks = (config?.webhooks ?? {}) as Record<string, unknown>;
  const aliases: Record<ClientWebhookKey, string[]> = {
    webhook_get_reservas: ['webhookLeerReservas', 'getReservas', 'getReservations'],
    webhook_walkin: ['webhookWalkin', 'walkin'],
    webhook_manual: ['webhookReservas', 'manual', 'reservas'],
    webhook_arrived: ['webhookLlegada', 'arrived', 'llegada'],
    webhook_mesa: ['webhookMesa', 'mesa'],
    webhook_fully_booked: ['webhookFullyBooked', 'fullyBooked'],
    webhook_cancel: ['webhookCancelReservationUrl', 'cancel', 'cancelReservation'],
    webhook_settings: ['webhookSettings', 'settings'],
    webhook_get_capacidad: ['WEBHOOK_GET_CAPACIDAD', 'webhookGetCapacidad', 'webhookGetCapacity', 'webhook_get_capacity', 'getCapacity', 'getCapacityWebhook', 'webhookCapacityGetUrl'],
    webhook_capacidad: ['WEBHOOK_CAPACIDAD', 'webhookCapacity', 'webhookSettingsCapacityUrl', 'webhook_settings_capacidad', 'webhook_capacidad_settings', 'settingsCapacity', 'capacitySettings'],
    webhook_get_mesas: ['webhook_leer_mesas', 'WEBHOOK_LEER_MESAS', 'webhookLeerMesas', 'webhookGetMesas', 'getMesas', 'tablesGet'],
    webhook_save_mesa: ['webhook_guardar_mesas', 'WEBHOOK_GUARDAR_MESAS', 'webhookGuardarMesas', 'webhookSaveMesa', 'saveMesa', 'tablesSave'],
    webhook_shows: ['webhookShows', 'shows'],
    webhook_feedbacks: ['webhook_leer_feedbacks', 'WEBHOOK_LEER_FEEDBACKS', 'webhookLeerFeedbacks', 'webhookFeedbacks', 'getFeedbacks', 'feedbacks'],
  };

  for (const alias of aliases[key]) {
    const value = toStringValue(webhooks[alias] ?? config?.[alias]);
    if (value) {
      return value;
    }
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
      toStringValue(config.client_id) &&
      toStringValue(config.rest_nombre),
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
    ...mockSettings,
    restaurantName: toStringValue(config.rest_nombre),
    costabotsLogoUrl: toStringValue(config.logo_costabots),
    restaurantLogoUrl: toStringValue(config.logo_restaurante),
    primaryColor: toStringValue(config.color) || mockSettings.primaryColor,
    googleSheetId: toStringValue(config.sheet_id),
    webhookLeerReservas: toStringValue(config.webhook_get_reservas),
    webhookWalkin: toStringValue(config.webhook_walkin),
    webhookReservas: toStringValue(config.webhook_manual),
    webhookLlegada: toStringValue(config.webhook_arrived),
    webhookMesa: toStringValue(config.webhook_mesa),
    webhookFullyBooked: toStringValue(config.webhook_fully_booked),
    webhookCancelReservationUrl: toStringValue(config.webhook_cancel),
    webhookGetMesas: pickClientWebhook(config, 'webhook_get_mesas'),
    webhookSaveMesa: pickClientWebhook(config, 'webhook_save_mesa'),
    webhookSettings: pickClientWebhook(config, 'webhook_settings'),
    webhookGetCapacidad: pickClientWebhook(config, 'webhook_get_capacidad'),
    webhookSettingsCapacityUrl: pickClientWebhook(config, 'webhook_capacidad'),
    webhookShows: toStringValue(config.webhook_shows),
    webhookFeedbacks: pickClientWebhook(config, 'webhook_feedbacks'),
    reservationsWebhook: '',
    walkInWebhook: '',
    feedbacksWebhook: '',
    showsWebhook: '',
  };
}

export function applyExternalClientConfig(settings: ManagerSettings, config: ExternalClientConfig): ManagerSettings {
  return populateAdminFromClientConfig(settings, config);
}
