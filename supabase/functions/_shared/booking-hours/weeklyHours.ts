export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const SERVICES = ['DESAYUNO', 'ALMUERZO', 'CENA'] as const;
export type WeeklyService = typeof SERVICES[number];
export type WeeklyServiceRule = { enabled: boolean; start: string | null; end: string | null };
export type WeeklyHoursConfig = Partial<Record<number, Partial<Record<WeeklyService, WeeklyServiceRule>>>>;

function parseTime(value: string | null) {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function getWeekday(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : parsed.getUTCDay();
}

export function resolveWeeklyServiceRule(config: WeeklyHoursConfig | null | undefined, date: string, service: WeeklyService) {
  const weekday = getWeekday(date);
  if (weekday === null) return { configured: true, rule: null } as const;
  const rule = config?.[weekday]?.[service];
  return rule ? { configured: true, rule } as const : { configured: false, rule: null } as const;
}

export function isServiceOpenAt(config: WeeklyHoursConfig | null | undefined, date: string, service: WeeklyService, time: string) {
  const resolved = resolveWeeklyServiceRule(config, date, service);
  if (!resolved.configured) return true;
  if (!resolved.rule?.enabled) return false;
  const start = parseTime(resolved.rule.start);
  const end = parseTime(resolved.rule.end);
  const slot = parseTime(time);
  if (start === null || end === null || slot === null || start === end) return false;
  return start < end && slot >= start && slot < end;
}

export function validateWeeklyHoursConfig(config: WeeklyHoursConfig) {
  const errors: string[] = [];
  for (const weekday of WEEKDAYS) for (const service of SERVICES) {
    const rule = config[weekday]?.[service];
    if (!rule) continue;
    const start = parseTime(rule.start), end = parseTime(rule.end);
    if (rule.enabled && (start === null || end === null || start >= end)) errors.push(`${weekday}.${service}`);
    if (!rule.enabled && (rule.start !== null || rule.end !== null)) errors.push(`${weekday}.${service}:disabled-with-times`);
  }
  return errors;
}
