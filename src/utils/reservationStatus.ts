import type { BookingStatus, Reservation } from '../types';

export function normalizeBookingStatus(status: string): BookingStatus {
  const normalized = status.trim().toUpperCase();
  return ['CANCELADA', 'CANCELADO', 'CANCELLED', 'CANCELED'].includes(normalized) ? 'CANCELADA' : 'CONFIRMADA';
}

export function isActiveReservation(reservation: Reservation) {
  return reservation.status === 'CONFIRMADA';
}

export function isCanceledReservation(reservation: Reservation) {
  return reservation.status === 'CANCELADA';
}
