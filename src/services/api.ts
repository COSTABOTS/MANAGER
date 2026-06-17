import { mockReservations, mockSettings, mockShows } from '../mock';
import { supabase } from '../lib/supabaseClient';
import { normalizeReservationFromSheet } from './reservationMapper';
import type { SheetReservationRow } from './reservationMapper';
import type { Reservation } from '../types';

interface ReservationsWebhookResponse {
  success?: boolean;
  reservas?: SheetReservationRow[];
  reservations?: SheetReservationRow[];
  data?: SheetReservationRow[];
  rows?: SheetReservationRow[];
}

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
  return rows.flatMap((row) => {
    const reservation = normalizeReservationFromSheet(row);
    return reservation ? [reservation] : [];
  });
}

function getReservationRows(data: ReservationsWebhookResponse | SheetReservationRow[]) {
  if (Array.isArray(data)) {
    return data;
  }

  return data.reservations ?? data.reservas ?? data.data ?? data.rows ?? [];
}

export async function loadReservations(webhookUrl: string, sheetId?: string): Promise<Reservation[]> {
  if (!webhookUrl.trim()) {
    throw new Error('Webhook leer reservas no configurado');
  }

  const response = await fetch(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accion: 'leer_reservas',
      action: 'GET_RESERVATIONS',
      sheet_id: sheetId ?? '',
      sheet: 'RESERVAS',
      hoja: 'RESERVAS',
      sheet_name: 'RESERVAS',
      source_sheet: 'RESERVAS',
      target_sheet: 'RESERVAS',
      view: 'all',
      include_cancelled: true,
      include_canceled: true,
      include_history: true,
      include_statuses: ['CONFIRMADA', 'CANCELADA'],
      exclude_today_sheet: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudieron cargar las reservas (${response.status})`);
  }

  const data = (await response.json()) as ReservationsWebhookResponse | SheetReservationRow[];
  const rows = getReservationRows(data);

  if (!Array.isArray(data) && data.success === false) {
    throw new Error('Respuesta de reservas no valida');
  }

  if (!Array.isArray(rows)) {
    throw new Error('Respuesta de reservas no valida');
  }

  return normalizeReservationsFromSheets(rows);
}

export async function loadReservationsFromManagerApi(): Promise<Reservation[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;

  console.log('[DEMO][MANAGER_API] session exists', Boolean(session));
  console.log('[DEMO][MANAGER_API] token exists', Boolean(session?.access_token));
  console.log('[DEMO][MANAGER_API] calling reservations.list');

  const { data, error } = await supabase.functions.invoke('manager-api', {
    body: { action: 'reservations.list' },
    headers: session?.access_token
      ? {
          Authorization: `Bearer ${session.access_token}`,
        }
      : undefined,
  });

  console.log('[DEMO][MANAGER_API] reservations.list response', data);

  if (error) {
    console.error('[DEMO][MANAGER_API] reservations.list error', error);
    throw error;
  }

  const response = data as ReservationsWebhookResponse & { ok?: boolean; code?: string; message?: string };

  if (!response?.ok) {
    throw new Error(response?.code || response?.message || 'manager-api reservations.list no devolvio ok=true');
  }

  const rows = getReservationRows(response);
  if (!Array.isArray(rows)) {
    throw new Error('manager-api reservations.list no devolvio reservations[]');
  }

  const reservations = normalizeReservationsFromSheets(rows);
  console.log('[DEMO][MANAGER_API] reservations received', reservations.length);

  return reservations;
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
