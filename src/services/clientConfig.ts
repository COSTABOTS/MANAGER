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
  | 'webhook_capacidad'
  | 'webhook_shows'
  | 'webhook_feedbacks';

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
  webhook_capacidad?: string;
  webhook_shows?: string;
  webhook_feedbacks?: string;
  webhooks?: Partial<
    Pick<
      ManagerSettings,
      | 'webhookReservas'
      | 'webhookWalkin'
      | 'webhookLlegada'
      | 'webhookMesa'
      | 'webhookFullyBooked'
      | 'webhookLeerReservas'
      | 'webhookCancelReservationUrl'
      | 'webhookSettingsCapacityUrl'
      | 'webhookShows'
      | 'webhookFeedbacks'
      | 'webhookSettings'
    >
  >;
  [key: string]: unknown;
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function applyTextValue<T extends keyof ManagerSettings>(
  target: ManagerSettings,
  key: T,
  value: unknown,
) {
  const nextValue = toStringValue(value);

  if (!nextValue) {
    return;
  }

  target[key] = nextValue as ManagerSettings[T];
}

export function getClientConfig(): ExternalClientConfig | null {
  try {
    const rawConfig = sessionStorage.getItem(CLIENT_CONFIG_KEY);

    if (!rawConfig) {
      return null;
    }

    return JSON.parse(rawConfig) as ExternalClientConfig;
  } catch {
    return null;
  }
}

export function getClientWebhook(key: ClientWebhookKey, fallbackUrl = '') {
  const config = getClientConfig();
  const dynamicUrl = toStringValue(config?.[key]);

  if (dynamicUrl) {
    console.log('Usando webhook dinámico:', key);
    return dynamicUrl;
  }

  console.warn(`Webhook dinámico no configurado: ${key}. Usando fallback.`);
  return fallbackUrl;
}

export function getClientSheetId(fallbackSheetId = '') {
  const config = getClientConfig();
  return toStringValue(config?.sheet_id) || toStringValue(config?.googleSheetId) || fallbackSheetId;
}

export function populateAdminFromClientConfig(
  settings: ManagerSettings,
  config: ExternalClientConfig | null = getClientConfig(),
): ManagerSettings {
  if (!config) {
    return settings;
  }

  const nextSettings = { ...settings };

  applyTextValue(nextSettings, 'restaurantName', config.rest_nombre ?? config.restaurantName);
  applyTextValue(nextSettings, 'costabotsLogoUrl', config.logo_costabots);
  applyTextValue(nextSettings, 'restaurantLogoUrl', config.logo_restaurante ?? config.restaurantLogoUrl);
  applyTextValue(nextSettings, 'primaryColor', config.color ?? config.primaryColor);
  applyTextValue(nextSettings, 'googleSheetId', config.sheet_id ?? config.googleSheetId);
  applyTextValue(nextSettings, 'webhookLeerReservas', config.webhook_get_reservas);
  applyTextValue(nextSettings, 'webhookWalkin', config.webhook_walkin);
  applyTextValue(nextSettings, 'webhookReservas', config.webhook_manual);
  applyTextValue(nextSettings, 'webhookLlegada', config.webhook_arrived);
  applyTextValue(nextSettings, 'webhookMesa', config.webhook_mesa);
  applyTextValue(nextSettings, 'webhookFullyBooked', config.webhook_fully_booked);
  applyTextValue(nextSettings, 'webhookCancelReservationUrl', config.webhook_cancel);
  applyTextValue(nextSettings, 'webhookSettings', config.webhook_settings);
  applyTextValue(nextSettings, 'webhookSettingsCapacityUrl', config.webhook_capacidad);
  applyTextValue(nextSettings, 'webhookShows', config.webhook_shows);
  applyTextValue(nextSettings, 'webhookFeedbacks', config.webhook_feedbacks);

  return {
    ...nextSettings,
    ...config.webhooks,
  };
}

export function applyExternalClientConfig(settings: ManagerSettings, config: ExternalClientConfig): ManagerSettings {
  return populateAdminFromClientConfig(settings, config);
}
