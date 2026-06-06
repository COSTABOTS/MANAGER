import { mockReservations, mockSettings, mockShows } from '../mock';
import { normalizeReservationFromSheet } from './reservationMapper';
import type { SheetReservationRow } from './reservationMapper';
import type { Reservation } from '../types';

export interface TodayData {
  date: string;
  bookingsOpen: boolean;
  fullyBooked: boolean;
  totalPax: number;
  capacity: number;
  arrivals: number;
  reservations: Reservation[];
}

export async function getTodayData(): Promise<TodayData> {
  const baseUrl = import.meta.env.VITE_MANAGER_API_URL;

  if (!baseUrl) {
    throw new Error('VITE_MANAGER_API_URL is not configured');
  }

  const response = await fetch(`${baseUrl}/today`);

  if (!response.ok) {
    throw new Error(`Today data request failed with status ${response.status}`);
  }

  return response.json();
}

export function hasTodayDataEndpoint() {
  return Boolean(import.meta.env.VITE_MANAGER_API_URL);
}

export async function getReservations() {
  return mockReservations;
}

export function normalizeReservationsFromSheets(rows: SheetReservationRow[]): Reservation[] {
  return rows.map(normalizeReservationFromSheet);
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
