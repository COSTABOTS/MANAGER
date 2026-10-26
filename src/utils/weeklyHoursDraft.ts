import type { ServiceWithHours } from '../types';

export const WEEKLY_DAYS = [
  { weekday: 1, label: 'Lunes' },
  { weekday: 2, label: 'Martes' },
  { weekday: 3, label: 'Miércoles' },
  { weekday: 4, label: 'Jueves' },
  { weekday: 5, label: 'Viernes' },
  { weekday: 6, label: 'Sábado' },
  { weekday: 0, label: 'Domingo' },
] as const;

export const RESTAURANT_SERVICES: ServiceWithHours[] = ['DESAYUNO', 'ALMUERZO', 'CENA'];
export type WeeklyDraftRule = { enabled: boolean; start: string; end: string };
export type WeeklyHoursDraft = Record<ServiceWithHours, Record<number, WeeklyDraftRule>>;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function createWeeklyHoursDraft(): WeeklyHoursDraft {
  return Object.fromEntries(RESTAURANT_SERVICES.map((service) => [
    service,
    Object.fromEntries(WEEKLY_DAYS.map(({ weekday }) => [weekday, { enabled: false, start: '', end: '' }])),
  ])) as WeeklyHoursDraft;
}

export function isValidWeeklyRule(rule: WeeklyDraftRule): boolean {
  return !rule.enabled || (TIME_PATTERN.test(rule.start) && TIME_PATTERN.test(rule.end) && rule.start < rule.end);
}

export function isCompleteWeeklyDraft(draft: WeeklyHoursDraft): boolean {
  return RESTAURANT_SERVICES.every((service) => WEEKLY_DAYS.every(({ weekday }) => {
    const rule = draft[service]?.[weekday];
    return Boolean(rule && isValidWeeklyRule(rule));
  }));
}

export function parseWeeklyHoursDraft(value: unknown): WeeklyHoursDraft | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const draft = createWeeklyHoursDraft();
  for (const service of RESTAURANT_SERVICES) {
    const days = source[service];
    if (!days || typeof days !== 'object') return null;
    for (const { weekday } of WEEKLY_DAYS) {
      const rule = (days as Record<number, unknown>)[weekday];
      if (!rule || typeof rule !== 'object') return null;
      const candidate = rule as Record<string, unknown>;
      if (typeof candidate.enabled !== 'boolean' || typeof candidate.start !== 'string' || typeof candidate.end !== 'string') return null;
      if (candidate.start && !TIME_PATTERN.test(candidate.start)) return null;
      if (candidate.end && !TIME_PATTERN.test(candidate.end)) return null;
      draft[service][weekday] = { enabled: candidate.enabled, start: candidate.start, end: candidate.end };
    }
  }
  return draft;
}

export function updateWeeklyRule(
  draft: WeeklyHoursDraft,
  service: ServiceWithHours,
  weekday: number,
  patch: Partial<WeeklyDraftRule>,
): WeeklyHoursDraft {
  return {
    ...draft,
    [service]: {
      ...draft[service],
      [weekday]: { ...draft[service][weekday], ...patch },
    },
  };
}

export function copyWeeklyRuleToOtherDays(
  draft: WeeklyHoursDraft,
  service: ServiceWithHours,
  sourceWeekday: number,
): WeeklyHoursDraft {
  const source = draft[service][sourceWeekday];
  return {
    ...draft,
    [service]: Object.fromEntries(WEEKLY_DAYS.map(({ weekday }) => [weekday, { ...source }])) as Record<number, WeeklyDraftRule>,
  };
}

export function toWeeklyHoursRows(draft: WeeklyHoursDraft) {
  return WEEKLY_DAYS.flatMap(({ weekday }) => RESTAURANT_SERVICES.map((service) => {
    const rule = draft[service][weekday];
    return {
      weekday,
      service,
      enabled: rule.enabled,
      start_time: rule.enabled ? rule.start : null,
      end_time: rule.enabled ? rule.end : null,
    };
  }));
}
