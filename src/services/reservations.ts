import { mockReservations } from '../mock';
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
