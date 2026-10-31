import type { ServiceWithHours } from '../types';
import type { WeeklyHoursRow } from '../services/weeklyHoursApiContract';

const SERVICES: ServiceWithHours[] = ['DESAYUNO', 'ALMUERZO', 'CENA'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/;

function minutes(value: string | null): number | null {
  if (!value || !TIME_PATTERN.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function formatTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

// Only the union of actual weekly booking hours is displayed. No capacity is inferred.
export function weeklyCapacitySlotUnion(
  rules: readonly WeeklyHoursRow[], interval: 30 | 60,
): Record<ServiceWithHours, string[]> | null {
  if (rules.length !== 21 || ![30, 60].includes(interval)) return null;
  const seen = new Set<string>();
  const slots: Record<ServiceWithHours, Set<string>> = {
    DESAYUNO: new Set(), ALMUERZO: new Set(), CENA: new Set(),
  };
  for (const rule of rules) {
    if (!SERVICES.includes(rule.service) || !Number.isInteger(rule.weekday)
      || rule.weekday < 0 || rule.weekday > 6) return null;
    const key = `${rule.weekday}:${rule.service}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (!rule.enabled) {
      if (rule.start_time !== null || rule.end_time !== null) return null;
      continue;
    }
    const start = minutes(rule.start_time);
    const end = minutes(rule.end_time);
    if (start === null || end === null || start >= end) return null;
    for (let time = start; time < end; time += interval) slots[rule.service].add(formatTime(time));
  }
  return {
    DESAYUNO: [...slots.DESAYUNO].sort(),
    ALMUERZO: [...slots.ALMUERZO].sort(),
    CENA: [...slots.CENA].sort(),
  };
}
