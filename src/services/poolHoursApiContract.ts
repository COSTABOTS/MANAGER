export type PoolHoursSnapshot = {
  configured: boolean;
  opening_time: string | null;
  closing_time: string | null;
  time_zone: 'Europe/Madrid';
  revision: string | null;
};

export type PoolHoursInvoker = (body: Record<string, unknown>) => Promise<unknown>;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const REVISION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parsePoolHoursResponse(value: unknown, action: 'poolHours.get' | 'poolHours.save', expectedClientId: string): PoolHoursSnapshot {
  if (!value || typeof value !== 'object') throw new Error('POOL_HOURS_RESPONSE_INVALID');
  const response = value as Record<string, unknown>;
  if (response.ok !== true || response.action !== action || response.client_id !== expectedClientId || response.time_zone !== 'Europe/Madrid') {
    throw new Error(typeof response.code === 'string' ? response.code : 'POOL_HOURS_RESPONSE_INVALID');
  }
  if (response.configured === false && response.opening_time === null
      && response.closing_time === null && response.revision === null) {
    return { configured: false, opening_time: null, closing_time: null, time_zone: 'Europe/Madrid', revision: null };
  }
  if (response.configured !== true || typeof response.opening_time !== 'string'
      || typeof response.closing_time !== 'string' || typeof response.revision !== 'string'
      || !TIME_PATTERN.test(response.opening_time) || !TIME_PATTERN.test(response.closing_time)
      || response.opening_time >= response.closing_time || !REVISION_PATTERN.test(response.revision)) {
    throw new Error('POOL_HOURS_RESPONSE_INVALID');
  }
  return {
    configured: true,
    opening_time: response.opening_time,
    closing_time: response.closing_time,
    time_zone: 'Europe/Madrid',
    revision: response.revision,
  };
}

export function createPoolHoursApi(call: PoolHoursInvoker, activeClientId: () => string) {
  function assertClient(expectedClientId: string) {
    if (!expectedClientId || activeClientId() !== expectedClientId) throw new Error('POOL_HOURS_TENANT_CHANGED');
  }
  return {
    async get(expectedClientId: string): Promise<PoolHoursSnapshot> {
      assertClient(expectedClientId);
      return parsePoolHoursResponse(await call({ action: 'poolHours.get' }), 'poolHours.get', expectedClientId);
    },
    async save(expectedClientId: string, openingTime: string, closingTime: string, expectedRevision: string | null): Promise<PoolHoursSnapshot> {
      assertClient(expectedClientId);
      return parsePoolHoursResponse(await call({
        action: 'poolHours.save',
        opening_time: openingTime,
        closing_time: closingTime,
        expected_revision: expectedRevision,
      }), 'poolHours.save', expectedClientId);
    },
  };
}
