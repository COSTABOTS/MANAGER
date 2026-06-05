import { mockSettings } from '../mock';
import type { ManagerSettings } from '../types';

export type RestaurantSettings = ManagerSettings;

export async function getSettings(): Promise<RestaurantSettings> {
  return mockSettings;
}

export async function saveSettings(settings: RestaurantSettings) {
  return {
    action: 'save_settings',
    settings,
  };
}
