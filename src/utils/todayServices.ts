import type { BookingService, Reservation } from '../types';

const TAB_ORDER: BookingService[] = ['DESAYUNO', 'ALMUERZO', 'CENA', 'BALINESA'];

export function getTodayTabServices(enabled: readonly BookingService[]): BookingService[] {
  return TAB_ORDER.filter((service) => enabled.includes(service));
}

export function getInactiveServiceReservations(
  reservations: readonly Reservation[],
  enabled: readonly BookingService[],
): Reservation[] {
  return reservations.filter((reservation) => !enabled.includes(reservation.service ?? 'CENA'));
}
