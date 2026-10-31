import type { BookingService, ServiceWithHours } from '../types';
import type { WeeklyHoursRow } from '../services/weeklyHoursApiContract';
import { generateTimeSlots } from './capacity';
import { getScheduledTodayTabs } from './todayServices';

export type MadridClock = { date: string; time: string };
export const WALK_IN_EARLY_MINUTES = 30;
export const WALK_IN_LATE_MINUTES = 30;

export function getMadridClock(now = new Date()): MadridClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}:${part('second')}` };
}

function normalizedTime(value: string): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
  return value.length === 5 ? `${value}:00` : value;
}

function openRule(enabled: readonly BookingService[], date: string, service: ServiceWithHours,
  rows: readonly WeeklyHoursRow[] | null): WeeklyHoursRow | null {
  const schedule = getScheduledTodayTabs(enabled, date, rows);
  if (schedule.status !== 'ready' || !schedule.tabs.includes(service)) return null;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return rows?.find((row) => row.weekday === weekday && row.service === service && row.enabled) ?? null;
}

export function getOpenRestaurantServiceAt(enabled: readonly BookingService[], clock: MadridClock,
  rows: readonly WeeklyHoursRow[] | null): ServiceWithHours | null {
  const time = normalizedTime(clock.time);
  if (!time) return null;
  const candidates: Array<{ service: ServiceWithHours; start: number; end: number }> = [];
  for (const service of ['DESAYUNO', 'ALMUERZO', 'CENA'] as const) {
    const rule = openRule(enabled, clock.date, service, rows);
    const start = normalizedTime(rule?.start_time ?? '');
    const end = normalizedTime(rule?.end_time ?? '');
    if (start && end) {
      candidates.push({ service,
        start: Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)),
        end: Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) });
    }
  }
  const seconds = Number(time.slice(0, 2)) * 3600 + Number(time.slice(3, 5)) * 60 + Number(time.slice(6, 8));
  // A service actually open now wins over another service's admission margin.
  return candidates.find(({ start, end }) => seconds >= start * 60 && seconds < end * 60)?.service
    ?? candidates.find(({ start, end }) => seconds >= Math.max(0, start - WALK_IN_EARLY_MINUTES) * 60
      && seconds <= Math.min(1440, end + WALK_IN_LATE_MINUTES) * 60)?.service
    ?? null;
}

export function getManualRestaurantServices(enabled: readonly BookingService[], date: string,
  rows: readonly WeeklyHoursRow[] | null): ServiceWithHours[] {
  return (['DESAYUNO', 'ALMUERZO', 'CENA'] as const).filter((service) => openRule(enabled, date, service, rows));
}

export function getManualRestaurantSlots(enabled: readonly BookingService[], date: string, service: ServiceWithHours,
  rows: readonly WeeklyHoursRow[] | null, interval: 30 | 60): string[] {
  const rule = openRule(enabled, date, service, rows);
  const start = normalizedTime(rule?.start_time ?? '');
  const end = normalizedTime(rule?.end_time ?? '');
  if (!start || !end) return [];
  return generateTimeSlots(start, end, interval).filter((slot) => `${slot}:00` >= start && `${slot}:00` < end);
}

export async function attemptWalkInCreate(create: () => Promise<void>): Promise<boolean> {
  try {
    await create();
    return true;
  } catch {
    return false;
  }
}
