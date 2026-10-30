import { getWeekday, isServiceOpenAt, isWeeklyService, type WeeklyHoursConfig, type WeeklyService } from '../_shared/booking-hours/weeklyHours.ts';
import { loadWeeklyHours, type WeeklyHoursReader } from '../_shared/booking-hours/weeklyHoursAdapter.ts';

// Keep the experimental early-admission window disabled for the first weekly activation.
const WALK_IN_EARLY_MINUTES = 0;

function isWalkInWithinService(config: WeeklyHoursConfig,
  date: string, service: WeeklyService, time: string): boolean {
  if (isServiceOpenAt(config, date, service, time.slice(0, 5))) return true;
  const weekday = getWeekday(date);
  const rule = weekday === null ? null : config[weekday]?.[service];
  if (!rule?.enabled || !rule.start) return false;
  const [hour, minute] = rule.start.split(':').map(Number);
  const [arrivalHour, arrivalMinute, arrivalSecond = 0] = time.split(':').map(Number);
  const startMinutes = hour * 60 + minute;
  const arrivalSeconds = arrivalHour * 3600 + arrivalMinute * 60 + arrivalSecond;
  return arrivalSeconds >= Math.max(0, startMinutes - WALK_IN_EARLY_MINUTES) * 60
    && arrivalSeconds < startMinutes * 60;
}

export type InternalCreateGuardResult =
  | { mode: 'legacy' }
  | { mode: 'weekly'; service: WeeklyService; date: string; time: string }
  | { mode: 'error'; code: 'WEEKLY_HOURS_CONFIG_READ_FAILED' | 'WEEKLY_HOURS_CONFIG_INVALID' |
      'SERVICE_NOT_ENABLED' | 'RESERVATION_OUTSIDE_WEEKLY_HOURS' | 'WALKIN_OUTSIDE_WEEKLY_HOURS'; status: number };

export function madridNow(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}:${value('second')}` };
}

export async function guardInternalWeeklyCreate(
  action: 'reservation.create' | 'walkin.create',
  input: { service: unknown; date: string; time: string },
  reader: WeeklyHoursReader,
  now = new Date(),
  enabled = false,
): Promise<InternalCreateGuardResult> {
  // An inactive server gate preserves the existing creation path without new reads.
  if (!enabled) return { mode: 'legacy' };
  // The existing Balinese path stays date-only and does not use restaurant rules.
  if (String(input.service ?? '').trim().toUpperCase() === 'BALINESA') return { mode: 'legacy' };
  const weekly = await loadWeeklyHours(reader).catch(() => ({
    mode: 'error' as const, error: { code: 'WEEKLY_HOURS_CONFIG_READ_FAILED' },
  }));
  if (weekly.mode === 'error') return {
    mode: 'error', code: weekly.error.code === 'WEEKLY_HOURS_CONFIG_INVALID'
      ? 'WEEKLY_HOURS_CONFIG_INVALID' : 'WEEKLY_HOURS_CONFIG_READ_FAILED', status: 503,
  };
  if (weekly.mode === 'legacy') return { mode: 'legacy' };

  const service = String(input.service ?? '').trim().toUpperCase();
  if (!isWeeklyService(service) || !weekly.servicesEnabled?.has(service)) {
    return { mode: 'error', code: 'SERVICE_NOT_ENABLED', status: 409 };
  }
  const clock = action === 'walkin.create' ? madridNow(now) : { date: input.date, time: input.time };
  const normalizedTime = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clock.time) ? clock.time.slice(0, 5) : '';
  if (!normalizedTime || !(action === 'walkin.create'
    ? isWalkInWithinService(weekly.config, clock.date, service, clock.time)
    : isServiceOpenAt(weekly.config, clock.date, service, normalizedTime))) {
    return { mode: 'error', code: action === 'walkin.create' ? 'WALKIN_OUTSIDE_WEEKLY_HOURS' : 'RESERVATION_OUTSIDE_WEEKLY_HOURS', status: 409 };
  }
  // Walk-ins use the server clock, never the date or time sent by the browser.
  return { mode: 'weekly', service, date: clock.date, time: action === 'walkin.create' ? normalizedTime : input.time };
}
