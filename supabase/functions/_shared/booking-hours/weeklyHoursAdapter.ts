import {
  SERVICES,
  WEEKDAYS,
  type WeeklyHoursConfig,
  type WeeklyService,
  type WeeklyServiceRule,
  validateWeeklyHoursConfig,
} from './weeklyHours.ts';

export type BookingServiceHoursRow = {
  weekday?: unknown;
  service?: unknown;
  enabled?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  start?: unknown;
  end?: unknown;
};

export type WeeklyHoursResolution =
  | { mode: 'legacy'; config: null; servicesEnabled: Set<WeeklyService> | null }
  | { mode: 'weekly'; config: WeeklyHoursConfig; servicesEnabled: Set<WeeklyService> | null }
  | { mode: 'error'; error: { code: string; message: string } };

function isEnabled(value: unknown) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return null;
}

function normalizeTime(value: unknown) {
  if (value === null || value === undefined || value === '') return { value: null, valid: true } as const;
  if (typeof value !== 'string') return { value: null, valid: false } as const;
  const minute = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (minute) return { value, valid: true } as const;
  const second = /^(?:[01]\d|2[0-3]):[0-5]\d:([0-5]\d)$/.exec(value);
  if (!second || second[1] !== '00') return { value: null, valid: false } as const;
  return { value: value.slice(0, 5), valid: true } as const;
}

function rowValue(row: BookingServiceHoursRow, primary: 'start_time' | 'end_time', legacy: 'start' | 'end') {
  return row[primary] !== undefined ? row[primary] : row[legacy];
}

function invalid(message: string): WeeklyHoursResolution {
  return { mode: 'error', error: { code: 'WEEKLY_HOURS_CONFIG_INVALID', message } };
}

export function resolveWeeklyHours(
  enabledSetting: unknown,
  rows: readonly BookingServiceHoursRow[] | null | undefined,
  readError: unknown = null,
): WeeklyHoursResolution {
  if (readError) return { mode: 'error', error: { code: 'WEEKLY_HOURS_CONFIG_READ_FAILED', message: 'Weekly hours configuration could not be read' } };
  const enabled = isEnabled(enabledSetting);
  if (enabled === null) return invalid('WEEKLY_HOURS_ENABLED is invalid');
  if (!enabled) return { mode: 'legacy', config: null, servicesEnabled: null };
  if (!rows || rows.length !== 21) return invalid('Weekly hours require exactly 21 rules');

  const config: WeeklyHoursConfig = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const weekday = typeof row.weekday === 'string' && /^\d+$/.test(row.weekday) ? Number(row.weekday) : row.weekday;
    const service = row.service;
    if (!WEEKDAYS.includes(weekday as typeof WEEKDAYS[number])) return invalid('weekday must be between 0 and 6');
    if (!SERVICES.includes(service as WeeklyService)) return invalid('service is not supported');
    const key = `${weekday}:${service}`;
    if (seen.has(key)) return invalid('weekly service rules must be unique');
    seen.add(key);
    const rowEnabled = isEnabled(row.enabled);
    if (rowEnabled === null) return invalid(`enabled is invalid for ${key}`);
    const start = normalizeTime(rowValue(row, 'start_time', 'start'));
    const end = normalizeTime(rowValue(row, 'end_time', 'end'));
    if (!start.valid || !end.valid) return invalid(`time format is invalid for ${key}`);
    const rule: WeeklyServiceRule = { enabled: rowEnabled, start: start.value, end: end.value };
    const day: Partial<Record<WeeklyService, WeeklyServiceRule>> = config[weekday as number] ?? {};
    day[service as WeeklyService] = rule;
    config[weekday as number] = day;
  }
  if (seen.size !== 21) return invalid('weekly service rules are incomplete');
  const validationErrors = validateWeeklyHoursConfig(config);
  if (validationErrors.length) return invalid(`weekly service rules are invalid: ${validationErrors.join(',')}`);
  return { mode: 'weekly', config, servicesEnabled: null };
}

export interface WeeklyHoursDbQuery {
  data: unknown;
  error: { message?: string } | null;
}

export interface WeeklyHoursDbQueryBuilder extends PromiseLike<WeeklyHoursDbQuery> {
  eq(column: string, value: unknown): WeeklyHoursDbQueryBuilder;
  in(column: string, values: unknown[]): WeeklyHoursDbQueryBuilder;
}

export interface WeeklyHoursDbClient {
  from(table: string): { select(columns: string): WeeklyHoursDbQueryBuilder };
}

export interface WeeklyHoursReader {
  readSettings(): Promise<WeeklyHoursDbQuery>;
  readRules(): Promise<WeeklyHoursDbQuery>;
}

export async function loadWeeklyHours(reader: WeeklyHoursReader): Promise<WeeklyHoursResolution> {
  const settingsResult = await reader.readSettings();
  if (settingsResult.error) return { mode: 'error', error: { code: 'WEEKLY_HOURS_CONFIG_READ_FAILED', message: 'Weekly hours configuration could not be read' } };
  const settings = Array.isArray(settingsResult.data) ? settingsResult.data as Array<Record<string, unknown>> : [];
  const settingsMap = new Map(settings.map((row) => [String(row.CLAVE ?? '').trim(), row.VALOR]));
  const resolution = resolveWeeklyHours(settingsMap.get('WEEKLY_HOURS_ENABLED'), [], null);
  const rawEnabled = settingsMap.get('WEEKLY_HOURS_ENABLED');
  const weeklyEnabled = rawEnabled === true || ['true', '1', 'yes', 'on'].includes(String(rawEnabled ?? '').trim().toLowerCase());
  if (!weeklyEnabled) return resolution;
  const rowsResult = await reader.readRules();
  if (rowsResult.error) return { mode: 'error', error: { code: 'WEEKLY_HOURS_CONFIG_READ_FAILED', message: 'Weekly hours configuration could not be read' } };
  const weekly = resolveWeeklyHours(rawEnabled, Array.isArray(rowsResult.data) ? rowsResult.data as BookingServiceHoursRow[] : [], null);
  if (weekly.mode !== 'weekly') return weekly;
  const servicesEnabled = new Set(String(settingsMap.get('SERVICES_ENABLED') ?? '').split(/[,;\n]/).map((value) => value.trim().toUpperCase()).filter((value): value is WeeklyService => SERVICES.includes(value as WeeklyService)));
  return { ...weekly, servicesEnabled: servicesEnabled.size ? servicesEnabled : null };
}
