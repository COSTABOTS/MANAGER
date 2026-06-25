import { mockReservations } from '../mock';
import type { DateBookingStatusValue, Reservation } from '../types';
import { createReservationId } from '../utils/reservationId';
import { invokeManagerApi } from './managerApiClient';

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

async function callReservationAction(action: 'reservation.create' | 'reservation.arrive' | 'reservation.assignTable' | 'reservation.cancel' | 'walkin.create', payload: Record<string, unknown>) {
  const data = await invokeManagerApi<{ ok?: boolean; code?: string; message?: string }>({
    action,
    ...payload,
  });

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
  servicio?: string;
  service?: string;
  paqueteBalinesa?: string;
  balinesePackage?: string;
  recurso?: string;
  resource?: string;
}) {
  const payload = {
    reservation: {
      ...reservation,
      origen: 'MANUAL',
      mesa: reservation.mesa ?? '',
      llego: Boolean(reservation.llego),
      habitacion: reservation.habitacion ?? '',
      servicio: reservation.servicio ?? reservation.service ?? 'CENA',
      service: reservation.service ?? reservation.servicio ?? 'CENA',
      paqueteBalinesa: reservation.paqueteBalinesa ?? reservation.balinesePackage ?? '',
      balinesePackage: reservation.balinesePackage ?? reservation.paqueteBalinesa ?? '',
      recurso: reservation.recurso ?? reservation.resource ?? '',
      resource: reservation.resource ?? reservation.recurso ?? '',
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

export async function cancelReservationWithManagerApi(idReserva: string) {
  const response = await callReservationAction('reservation.cancel', { idReserva });
  console.log('[DEMO][RESERVATION] cancelled');
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
  servicio?: string;
  service?: string;
}) {
  const body = {
    walkin: {
      ...walkin,
      idioma: walkin.idioma ?? 'ES',
      mesa: walkin.mesa ?? '',
      peticionEspecial: walkin.peticionEspecial ?? '',
      habitacion: walkin.habitacion ?? '',
      servicio: walkin.servicio ?? walkin.service ?? 'CENA',
      service: walkin.service ?? walkin.servicio ?? 'CENA',
    },
  };
  console.log('[STEP2] payload', body);
  const response = await callReservationAction('walkin.create', body) as { ok?: boolean; idReserva?: string };
  console.log('[DEMO][WALKIN] created', response.idReserva);
  return response;
}
