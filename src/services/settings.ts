import { mockSettings } from '../mock';
import type { ManagerSettings } from '../types';
import { buildOperationalSettingsPayload } from './operationalSettings';

export type RestaurantSettings = ManagerSettings;

export async function getSettings(): Promise<RestaurantSettings> {
  return mockSettings;
}

export async function saveSettings(settings: RestaurantSettings) {
  return {
    action: 'save_settings',
    settings: buildOperationalSettingsPayload(settings),
  };
}
