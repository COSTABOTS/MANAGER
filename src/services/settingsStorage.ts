import { mockSettings } from '../mock';
import type { ManagerSettings } from '../types';

const SETTINGS_STORAGE_KEY = 'manager_settings';

function normalizeSettings(storedSettings: Partial<ManagerSettings> & { logoUrl?: string }): ManagerSettings {
  return {
    ...mockSettings,
    ...storedSettings,
    costabotsLogoUrl: storedSettings.costabotsLogoUrl ?? mockSettings.costabotsLogoUrl,
    restaurantLogoUrl: storedSettings.restaurantLogoUrl ?? storedSettings.logoUrl ?? mockSettings.restaurantLogoUrl,
    webhookReservas: storedSettings.webhookReservas ?? storedSettings.reservationsWebhook ?? mockSettings.webhookReservas,
    webhookWalkin: storedSettings.webhookWalkin ?? storedSettings.walkInWebhook ?? mockSettings.webhookWalkin,
    webhookFeedbacks: storedSettings.webhookFeedbacks ?? storedSettings.feedbacksWebhook ?? mockSettings.webhookFeedbacks,
    webhookShows: storedSettings.webhookShows ?? storedSettings.showsWebhook ?? mockSettings.webhookShows,
    webhookLlegada: storedSettings.webhookLlegada ?? mockSettings.webhookLlegada,
    webhookMesa: storedSettings.webhookMesa ?? mockSettings.webhookMesa,
    webhookFullyBooked: storedSettings.webhookFullyBooked ?? mockSettings.webhookFullyBooked,
    webhookLeerReservas: storedSettings.webhookLeerReservas ?? mockSettings.webhookLeerReservas,
    webhookCancelReservationUrl: storedSettings.webhookCancelReservationUrl ?? mockSettings.webhookCancelReservationUrl,
    webhookGetMesas: storedSettings.webhookGetMesas ?? mockSettings.webhookGetMesas,
    webhookSaveMesa: storedSettings.webhookSaveMesa ?? mockSettings.webhookSaveMesa,
    webhookSettingsCapacityUrl: storedSettings.webhookSettingsCapacityUrl ?? mockSettings.webhookSettingsCapacityUrl,
    webhookSettings: storedSettings.webhookSettings ?? mockSettings.webhookSettings,
    openingDays: {
      ...mockSettings.openingDays,
      ...(storedSettings.openingDays ?? {}),
    },
    slotCapacity: {
      ...mockSettings.slotCapacity,
      ...(storedSettings.slotCapacity ?? {}),
    },
    tables: mockSettings.tables,
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
    const { tables: _tables, ...settingsWithoutTables } = settings;
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsWithoutTables));
  } catch {
    // Local storage can be unavailable in private browsing or restricted contexts.
  }
}

export function clearSettingsStorage() {
  try {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in private browsing or restricted contexts.
  }
}
