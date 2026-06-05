import { mockSettings } from '../mock';
import type { ManagerSettings } from '../types';

const SETTINGS_STORAGE_KEY = 'manager_settings';

function normalizeSettings(storedSettings: Partial<ManagerSettings> & { logoUrl?: string }): ManagerSettings {
  return {
    ...mockSettings,
    ...storedSettings,
    costabotsLogoUrl: storedSettings.costabotsLogoUrl ?? mockSettings.costabotsLogoUrl,
    restaurantLogoUrl: storedSettings.restaurantLogoUrl ?? storedSettings.logoUrl ?? mockSettings.restaurantLogoUrl,
    openingDays: {
      ...mockSettings.openingDays,
      ...(storedSettings.openingDays ?? {}),
    },
    slotCapacity: {
      ...mockSettings.slotCapacity,
      ...(storedSettings.slotCapacity ?? {}),
    },
    tables: Array.isArray(storedSettings.tables) ? storedSettings.tables : mockSettings.tables,
  };
}

export function loadSettingsFromStorage(): ManagerSettings {
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) {
      return mockSettings;
    }

    return normalizeSettings(JSON.parse(stored));
  } catch {
    return mockSettings;
  }
}

export function saveSettingsToStorage(settings: ManagerSettings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Local storage can be unavailable in private browsing or restricted contexts.
  }
}
