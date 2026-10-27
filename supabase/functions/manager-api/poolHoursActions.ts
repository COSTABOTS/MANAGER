export type PoolHoursSnapshot = {
  configured: boolean;
  opening_time: string | null;
  closing_time: string | null;
  time_zone: 'Europe/Madrid';
  revision: string | null;
};

export type PoolHoursAccess = {
  read(clientId: string): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  replace(clientId: string, openingTime: string, closingTime: string, expectedRevision: string | null): Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export type PoolHoursOutcome =
  | { ok: true; snapshot: PoolHoursSnapshot }
  | { ok: false; code: 'POOL_HOURS_INVALID' | 'POOL_HOURS_CONFLICT' | 'POOL_HOURS_READ_FAILED' | 'POOL_HOURS_SAVE_FAILED' | 'POOL_HOURS_CONFIG_INVALID' };

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const REVISION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function normalizePoolHoursSnapshot(value: unknown): PoolHoursSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.time_zone !== 'Europe/Madrid') return null;
  if (row.configured === false && row.opening_time === null && row.closing_time === null && row.revision === null) {
    return { configured: false, opening_time: null, closing_time: null, time_zone: 'Europe/Madrid', revision: null };
  }
  if (row.configured !== true || typeof row.opening_time !== 'string' || typeof row.closing_time !== 'string'
      || !TIME_PATTERN.test(row.opening_time) || !TIME_PATTERN.test(row.closing_time)
      || row.opening_time >= row.closing_time || typeof row.revision !== 'string'
      || !REVISION_PATTERN.test(row.revision)) return null;
  return {
    configured: true,
    opening_time: row.opening_time,
    closing_time: row.closing_time,
    time_zone: 'Europe/Madrid',
    revision: row.revision,
  };
}

export function poolHoursHttpStatus(code: Extract<PoolHoursOutcome, { ok: false }>['code']): number {
  return code === 'POOL_HOURS_INVALID' ? 400 : code === 'POOL_HOURS_CONFLICT' ? 409 : 503;
}

export function classifyPoolHoursRpcError(error: { code?: string; message?: string } | null):
  'invalid' | 'conflict' | 'server' | null {
  if (!error) return null;
  if (error.code === 'P0001' && error.message === 'POOL_HOURS_INVALID') return 'invalid';
  if (error.code === 'P0001' && error.message === 'POOL_HOURS_CONFLICT') return 'conflict';
  return 'server';
}

export async function readPoolHours(access: PoolHoursAccess, clientId: string): Promise<PoolHoursOutcome> {
  const result = await access.read(clientId).catch(() => ({ data: null, error: { message: 'READ_FAILED' } }));
  if (result.error) return { ok: false, code: 'POOL_HOURS_READ_FAILED' };
  const snapshot = normalizePoolHoursSnapshot(result.data);
  return snapshot ? { ok: true, snapshot } : { ok: false, code: 'POOL_HOURS_CONFIG_INVALID' };
}

export async function savePoolHours(
  access: PoolHoursAccess,
  clientId: string,
  openingTime: unknown,
  closingTime: unknown,
  expectedRevision: unknown,
): Promise<PoolHoursOutcome> {
  if (typeof openingTime !== 'string' || typeof closingTime !== 'string'
      || !TIME_PATTERN.test(openingTime) || !TIME_PATTERN.test(closingTime)
      || openingTime >= closingTime
      || (expectedRevision !== null && (typeof expectedRevision !== 'string' || !REVISION_PATTERN.test(expectedRevision)))) {
    return { ok: false, code: 'POOL_HOURS_INVALID' };
  }
  const result = await access.replace(clientId, openingTime, closingTime, expectedRevision as string | null)
    .catch(() => ({ data: null, error: { message: 'SAVE_FAILED' } }));
  const category = classifyPoolHoursRpcError(result.error);
  if (category === 'invalid') return { ok: false, code: 'POOL_HOURS_INVALID' };
  if (category === 'conflict') return { ok: false, code: 'POOL_HOURS_CONFLICT' };
  if (category === 'server') return { ok: false, code: 'POOL_HOURS_SAVE_FAILED' };
  const snapshot = normalizePoolHoursSnapshot(result.data);
  return snapshot?.configured ? { ok: true, snapshot } : { ok: false, code: 'POOL_HOURS_SAVE_FAILED' };
}

export function executePoolHoursAction(
  access: PoolHoursAccess,
  action: 'poolHours.get' | 'poolHours.save',
  authenticatedClientId: string,
  body: Record<string, unknown>,
): Promise<PoolHoursOutcome> {
  return action === 'poolHours.get'
    ? readPoolHours(access, authenticatedClientId)
    : savePoolHours(access, authenticatedClientId, body.opening_time, body.closing_time, body.expected_revision);
}
