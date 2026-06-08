import type { ManagerSettings } from '../types';

export interface ExternalClientConfig {
  clientId?: string;
  restaurantName?: string;
  restaurantLogoUrl?: string;
  primaryColor?: string;
  googleSheetId?: string;
  webhooks?: Partial<
    Pick<
      ManagerSettings,
      | 'webhookReservas'
      | 'webhookWalkin'
      | 'webhookLlegada'
      | 'webhookMesa'
      | 'webhookFullyBooked'
      | 'webhookLeerReservas'
      | 'webhookAvailability'
      | 'webhookShows'
      | 'webhookFeedbacks'
      | 'webhookSettings'
    >
  >;
}

export function applyExternalClientConfig(settings: ManagerSettings, config: ExternalClientConfig): ManagerSettings {
  return {
    ...settings,
    restaurantName: config.restaurantName ?? settings.restaurantName,
    restaurantLogoUrl: config.restaurantLogoUrl ?? settings.restaurantLogoUrl,
    primaryColor: config.primaryColor ?? settings.primaryColor,
    googleSheetId: config.googleSheetId ?? settings.googleSheetId,
    ...config.webhooks,
  };
}
