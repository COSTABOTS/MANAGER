import { mockReservations, mockSettings, mockShows } from '../data/mockData';

export async function getReservations() {
  return mockReservations;
}

export async function getControlDates() {
  return [];
}

export async function getFeedbacks() {
  return [];
}

export async function getShows() {
  return mockShows;
}

export async function getSettings() {
  return mockSettings;
}

export async function addWalkIn() {}

export async function updateArrival() {}

export async function updateTable() {}

export async function updateBookingStatus() {}

export async function updateDateBookingStatus() {}

export async function saveSettings() {}

export async function createShow() {}

export async function updateShow() {}

export async function toggleShowStatus(showId?: string, active?: boolean) {
  if (!showId || active === undefined) {
    return;
  }

  return {
    action: 'toggle_show',
    show_id: showId,
    active,
    visibleInChatbot: active,
    bookable: active,
  };
}
