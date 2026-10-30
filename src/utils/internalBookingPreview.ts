import type { BookingService, ServiceWithHours } from '../types';
import type { WeeklyHoursRow } from '../services/weeklyHoursApiContract';
import { generateTimeSlots } from './capacity';
import { getScheduledTodayTabs } from './todayServices';

export type MadridClock = { date: string; time: string };
// Early admission stays disabled until capacity attribution is deployed and verified.
export const WALK_IN_EARLY_MINUTES = 0;

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
  for (const service of ['DESAYUNO', 'ALMUERZO', 'CENA'] as const) {
    const rule = openRule(enabled, clock.date, service, rows);
    const start = normalizedTime(rule?.start_time ?? '');
    const end = normalizedTime(rule?.end_time ?? '');
    if (start && end) {
      const startMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
      const earliest = Math.max(0, startMinutes - WALK_IN_EARLY_MINUTES);
      const earliestTime = `${String(Math.floor(earliest / 60)).padStart(2, '0')}:${String(earliest % 60).padStart(2, '0')}:00`;
      if (time >= earliestTime && time < end) return service;
    }
  }
  return null;
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
