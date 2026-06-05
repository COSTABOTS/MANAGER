import { mockReservations } from '../mock';
import type { DateBookingStatusValue, Reservation } from '../types';

export async function getReservations(): Promise<Reservation[]> {
  return mockReservations;
}

export async function addManualReservation(reservation: Omit<Reservation, 'id'>): Promise<Reservation> {
  return {
    ...reservation,
    id: `manual-${Date.now()}`,
  };
}

export async function updateArrival(reservationId: string, arrived: boolean) {
  return {
    action: 'update_arrival',
    reservationId,
    arrived,
  };
}

export async function updateTable(reservationId: string, table: string) {
  return {
    action: 'update_table',
    reservationId,
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
