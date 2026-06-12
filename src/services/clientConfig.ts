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
  const dynamicUrl = toStringValue(config?.[key]);

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
    webhookSettings: toStringValue(config.webhook_settings),
    webhookSettingsCapacityUrl: toStringValue(config.webhook_capacidad),
    webhookShows: toStringValue(config.webhook_shows),
    webhookFeedbacks: toStringValue(config.webhook_feedbacks),
    reservationsWebhook: '',
    walkInWebhook: '',
    feedbacksWebhook: '',
    showsWebhook: '',
  };
}

export function applyExternalClientConfig(settings: ManagerSettings, config: ExternalClientConfig): ManagerSettings {
  return populateAdminFromClientConfig(settings, config);
}
