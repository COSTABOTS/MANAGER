import type { BookingService, Reservation } from '../types';
import type { WeeklyHoursRow } from '../services/weeklyHoursApiContract';
import { isValidWeeklyRule, RESTAURANT_SERVICES, WEEKLY_DAYS } from './weeklyHoursDraft';

const TAB_ORDER: BookingService[] = ['DESAYUNO', 'ALMUERZO', 'CENA', 'BALINESA'];

export function getTodayTabServices(enabled: readonly BookingService[]): BookingService[] {
  return TAB_ORDER.filter((service) => enabled.includes(service));
}

export function getScheduledTodayTabs(
  enabled: readonly BookingService[],
  date: string,
  rows: readonly WeeklyHoursRow[] | null,
): { tabs: BookingService[]; status: 'ready' | 'unavailable' } {
  const fallback = { tabs: getTodayTabServices(enabled), status: 'unavailable' as const };
  if (!rows || rows.length !== 21 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fallback;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return fallback;
  const keys = new Set<string>();
  for (const row of rows) {
    if (!RESTAURANT_SERVICES.includes(row.service) || !WEEKLY_DAYS.some((day) => day.weekday === row.weekday)
      || typeof row.enabled !== 'boolean'
      || !isValidWeeklyRule({ enabled: row.enabled, start: row.start_time?.slice(0, 5) ?? '', end: row.end_time?.slice(0, 5) ?? '' })) return fallback;
    keys.add(`${row.weekday}:${row.service}`);
  }
  if (keys.size !== 21) return fallback;
  const weekday = parsed.getUTCDay();
  return {
    tabs: getTodayTabServices(enabled).filter((service) => service === 'BALINESA'
      || rows.some((row) => row.weekday === weekday && row.service === service && row.enabled)),
    status: 'ready',
  };
}

export function getInactiveServiceReservations(
  reservations: readonly Reservation[],
  enabled: readonly BookingService[],
): Reservation[] {
  return reservations.filter((reservation) => !enabled.includes(reservation.service ?? 'CENA'));
}
