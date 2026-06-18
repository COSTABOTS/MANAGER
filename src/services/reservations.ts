import { mockReservations } from '../mock';
import { supabase } from '../lib/supabaseClient';
import type { DateBookingStatusValue, Reservation } from '../types';
import { createReservationId } from '../utils/reservationId';

export async function getReservations(): Promise<Reservation[]> {
  return mockReservations;
}

export async function addManualReservation(reservation: Omit<Reservation, 'id' | 'idReserva'>): Promise<Reservation> {
  const idReserva = createReservationId();

  return {
    ...reservation,
    id: idReserva,
    idReserva,
  };
}

export async function updateArrival(idReserva: string, arrived: boolean) {
  return {
    action: 'update_arrival',
    idReserva,
    arrived,
  };
}

export async function updateTable(idReserva: string, table: string) {
  return {
    action: 'update_table',
    idReserva,
    table,
  };
}

export async function updateBookingStatus(date: string, status: DateBookingStatusValue) {
  return {
    action: 'update_booking_status',
    date,
    status,
  };
}

async function callReservationAction(action: 'reservation.create' | 'reservation.arrive' | 'reservation.assignTable' | 'walkin.create', payload: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;

  const { data, error } = await supabase.functions.invoke('manager-api', {
    body: {
      action,
      ...payload,
    },
    headers: session?.access_token
      ? {
          Authorization: `Bearer ${session.access_token}`,
        }
      : undefined,
  });

  if (error) {
    throw error;
  }

  const response = data as { ok?: boolean; code?: string; message?: string };
  if (!response?.ok) {
    throw new Error(response?.code || response?.message || `${action} no devolvio ok=true`);
  }

  return response;
}

export async function createManualReservationWithManagerApi(reservation: {
  nombre: string;
  telefono?: string;
  fecha: string;
  hora: string;
  pax: number;
  habitacion?: string;
  idioma?: string;
  peticionEspecial?: string;
  mesa?: string;
  llego?: boolean;
}) {
  const payload = {
    reservation: {
      ...reservation,
      origen: 'MANUAL',
      mesa: reservation.mesa ?? '',
      llego: Boolean(reservation.llego),
      habitacion: reservation.habitacion ?? '',
    },
  };
  console.log('[DEMO][RESERVATION_CREATE] payload', payload);
  const response = await callReservationAction('reservation.create', {
    ...payload,
  }) as { ok?: boolean; idReserva?: string };
  console.log('[DEMO][RESERVATION] created', response.idReserva);
  return response;
}

export async function saveArrivalWithManagerApi(idReserva: string, llego: boolean) {
  const response = await callReservationAction('reservation.arrive', { idReserva, llego });
  console.log('[DEMO][RESERVATION] arrive saved');
  return response;
}

export async function assignTableWithManagerApi(idReserva: string, mesa: string) {
  const response = await callReservationAction('reservation.assignTable', { idReserva, mesa });
  console.log('[DEMO][RESERVATION] table assigned');
  return response;
}

export async function createWalkInWithManagerApi(walkin: {
  nombre: string;
  pax: number;
  fecha: string;
  hora: string;
  mesa?: string;
  peticionEspecial?: string;
  habitacion?: string;
  idioma?: string;
}) {
  const response = await callReservationAction('walkin.create', {
    walkin: {
      ...walkin,
      idioma: walkin.idioma ?? 'ES',
      mesa: walkin.mesa ?? '',
      peticionEspecial: walkin.peticionEspecial ?? '',
      habitacion: walkin.habitacion ?? '',
    },
  }) as { ok?: boolean; idReserva?: string };
  console.log('[DEMO][WALKIN] created', response.idReserva);
  return response;
}
