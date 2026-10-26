export type WeeklyHourRule = {
  weekday: number;
  service: 'DESAYUNO' | 'ALMUERZO' | 'CENA';
  enabled: boolean;
  start_time: string | null;
  end_time: string | null;
};

type ReadResult = { rows: unknown[]; revision: unknown; error: boolean };
type ReplaceResult = { revision: unknown; error: 'conflict' | 'invalid' | 'server' | null };
export function classifyWeeklyHoursRpcError(error: { code?: string; message?: string } | null): ReplaceResult['error'] {
  if (!error) return null;
  if (error.code === 'P0001' && error.message === 'WEEKLY_HOURS_CONFLICT') return 'conflict';
  if (error.code === 'P0001' && error.message === 'WEEKLY_HOURS_REQUIRES_21_UNIQUE_RULES') return 'invalid';
  return 'server';
}
export type WeeklyHoursAccess = {
  read: (clientId: string) => Promise<ReadResult>;
  replace: (clientId: string, rules: WeeklyHourRule[], expectedRevision: string) => Promise<ReplaceResult>;
};

export type WeeklyHoursOutcome =
  | { ok: true; rules: WeeklyHourRule[]; revision: string }
  | { ok: false; code: 'WEEKLY_HOURS_INVALID' | 'WEEKLY_HOURS_READ_FAILED' | 'WEEKLY_HOURS_SAVE_FAILED' | 'WEEKLY_HOURS_CONFLICT' };

export function weeklyHoursHttpStatus(code: Extract<WeeklyHoursOutcome, { ok: false }>['code']): number {
  return code === 'WEEKLY_HOURS_CONFLICT' ? 409 : code === 'WEEKLY_HOURS_INVALID' ? 400 : 503;
}

const services = ['DESAYUNO', 'ALMUERZO', 'CENA'] as const;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/;

function normalizeTime(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !timePattern.test(value)) return undefined;
  return value.slice(0, 5);
}

export function normalizeWeeklyRules(value: unknown): WeeklyHourRule[] | null {
  if (!Array.isArray(value) || value.length !== 21) return null;
  const seen = new Set<string>();
  const rules: WeeklyHourRule[] = [];
  for (const valueRow of value) {
    if (!valueRow || typeof valueRow !== 'object') return null;
    const row = valueRow as Record<string, unknown>;
    if (!Number.isInteger(row.weekday) || (row.weekday as number) < 0 || (row.weekday as number) > 6 ||
        !services.includes(row.service as WeeklyHourRule['service']) || typeof row.enabled !== 'boolean') return null;
    const key = `${row.weekday}:${row.service}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const start = normalizeTime(row.start_time);
    const end = normalizeTime(row.end_time);
    if (start === undefined || end === undefined) return null;
    if (row.enabled ? start === null || end === null || start >= end : start !== null || end !== null) return null;
    rules.push({ weekday: row.weekday as number, service: row.service as WeeklyHourRule['service'], enabled: row.enabled, start_time: start, end_time: end });
  }
  return rules.sort((a, b) => a.weekday - b.weekday || services.indexOf(a.service) - services.indexOf(b.service));
}

async function loadSnapshot(access: WeeklyHoursAccess, clientId: string): Promise<WeeklyHoursOutcome> {
  const result = await access.read(clientId).catch(() => ({ rows: [], revision: null, error: true }));
  if (result.error) return { ok: false, code: 'WEEKLY_HOURS_READ_FAILED' };
  if (typeof result.revision !== 'string' || !/^[a-f0-9]{64}$/.test(result.revision)) {
    return { ok: false, code: 'WEEKLY_HOURS_READ_FAILED' };
  }
  if (result.rows.length === 0) return { ok: true, rules: [], revision: result.revision };
  const rules = normalizeWeeklyRules(result.rows);
  if (!rules) return { ok: false, code: 'WEEKLY_HOURS_INVALID' };
  return { ok: true, rules, revision: result.revision };
}

export function readWeeklyHours(access: WeeklyHoursAccess, clientId: string) {
  return loadSnapshot(access, clientId);
}

export async function saveWeeklyHours(
  access: WeeklyHoursAccess,
  clientId: string,
  requestedRules: unknown,
  expectedRevision: unknown,
): Promise<WeeklyHoursOutcome> {
  const rules = normalizeWeeklyRules(requestedRules);
  if (!rules || typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
    return { ok: false, code: 'WEEKLY_HOURS_INVALID' };
  }
  const saved: ReplaceResult = await access.replace(clientId, rules, expectedRevision)
    .catch(() => ({ revision: null, error: 'server' as const }));
  if (saved.error === 'conflict') return { ok: false, code: 'WEEKLY_HOURS_CONFLICT' };
  if (saved.error === 'invalid') return { ok: false, code: 'WEEKLY_HOURS_INVALID' };
  if (saved.error || typeof saved.revision !== 'string' || !/^[a-f0-9]{64}$/.test(saved.revision)) {
    return { ok: false, code: 'WEEKLY_HOURS_SAVE_FAILED' };
  }
  return { ok: true, rules, revision: saved.revision };
}
