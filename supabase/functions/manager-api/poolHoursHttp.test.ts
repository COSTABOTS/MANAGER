import { handlePoolHoursHttp, type PoolHoursAuthContext, type PoolHoursResponseWriters } from './poolHoursHttp.ts';
import type { PoolHoursAccess, PoolHoursSnapshot } from './poolHoursActions.ts';
import { canWriteRemoteHours } from './hoursWriteGate.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const revisionA = '11111111-1111-4111-8111-111111111111';
const revisionB = '22222222-2222-4222-8222-222222222222';
const empty: PoolHoursSnapshot = {
  configured: false, opening_time: null, closing_time: null,
  time_zone: 'Europe/Madrid', revision: null,
};

function fakeServer(enabled?: string, allowedClientIds?: string) {
  const rows = new Map<string, PoolHoursSnapshot>();
  let writes = 0;
  let accessCreated = 0;
  let readFailure = false;
  const access: PoolHoursAccess = {
    async read(clientId) {
      return readFailure
        ? { data: null, error: { message: 'temporary database failure' } }
        : { data: rows.get(clientId) ?? empty, error: null };
    },
    async replace(clientId, openingTime, closingTime, expectedRevision) {
      const current = rows.get(clientId) ?? empty;
      if (current.revision !== expectedRevision) {
        return { data: null, error: { code: 'P0001', message: 'POOL_HOURS_CONFLICT' } };
      }
      writes += 1;
      const next: PoolHoursSnapshot = {
        configured: true, opening_time: openingTime, closing_time: closingTime,
        time_zone: 'Europe/Madrid', revision: writes === 1 ? revisionA : revisionB,
      };
      rows.set(clientId, next);
      return { data: next, error: null };
    },
  };
  const respond: PoolHoursResponseWriters = {
    success: (_request, payload) => Response.json(payload),
    failure: (_request, code, status) => Response.json({ ok: false, code, error: code, message: code, context: {}, debug: {} }, { status }),
  };
  async function send(action: 'poolHours.get' | 'poolHours.save', token: string, payload: Record<string, unknown> = {}) {
    const request = new Request('https://manager-api.invalid/', {
      method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    const authorize = async (incoming: Request): Promise<PoolHoursAuthContext | Response | null> => {
      const identity = incoming.headers.get('Authorization');
      return identity === 'tenant-A' ? { clientId: 'A', role: 'ADMIN', serviceRoleAvailable: true }
        : identity === 'tenant-B' ? { clientId: 'B', role: 'ADMIN', serviceRoleAvailable: true }
        : identity === 'tenant-A-manager' ? { clientId: 'A', role: 'MANAGER', serviceRoleAvailable: true }
        : identity === 'no-service-role' ? { clientId: 'A', role: 'ADMIN', serviceRoleAvailable: false }
        : respond.failure(incoming, 'UNAUTHENTICATED', 200);
    };
    const response = await handlePoolHoursHttp(request, { action, ...payload }, action, authorize, () => {
      accessCreated += 1;
      return access;
    }, respond, (clientId) => canWriteRemoteHours(clientId, enabled, allowedClientIds));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  return { send, rows, get writes() { return writes; }, get accessCreated() { return accessCreated; }, setReadFailure(value: boolean) { readFailure = value; } };
}

Deno.test('authenticated HTTP get/save isolate tenants and return unconfigured state', async () => {
  const server = fakeServer('true', 'A');
  const emptyA = await server.send('poolHours.get', 'tenant-A', { client_id: 'B' });
  assert(emptyA.status === 200 && emptyA.body.client_id === 'A' && emptyA.body.configured === false && emptyA.body.opening_time === null, 'unconfigured A has no default and echoes the resolved tenant');
  const saved = await server.send('poolHours.save', 'tenant-A', {
    client_id: 'B', opening_time: '10:00', closing_time: '19:00', expected_revision: null,
  });
  assert(saved.status === 200 && saved.body.client_id === 'A' && saved.body.revision === revisionA && server.rows.has('A') && !server.rows.has('B'), 'forged tenant is ignored');
  const other = await server.send('poolHours.get', 'tenant-B', { client_id: 'A' });
  assert(other.status === 200 && other.body.client_id === 'B' && other.body.configured === false, 'B cannot read A through the action');
  assert(server.writes === 1, 'only one write reached persistence');
});

Deno.test('missing auth and missing service role reject before constructing access', async () => {
  const server = fakeServer();
  const unauthenticated = await server.send('poolHours.save', '', {
    opening_time: '10:00', closing_time: '19:00', expected_revision: null,
  });
  const unavailable = await server.send('poolHours.get', 'no-service-role');
  assert(unauthenticated.status === 200 && unauthenticated.body.code === 'UNAUTHENTICATED', 'existing Manager auth contract is retained');
  assert(unavailable.status === 503 && unavailable.body.code === 'POOL_HOURS_UNAVAILABLE', 'service role is required');
  assert(server.accessCreated === 0 && server.writes === 0, 'no database access before authorization');
});

Deno.test('HTTP validation and stale revisions return 400/409 with zero rejected writes', async () => {
  const server = fakeServer('true', 'A');
  const bad = await server.send('poolHours.save', 'tenant-A', {
    opening_time: '19:00', closing_time: '10:00', expected_revision: null,
  });
  assert(bad.status === 400 && bad.body.code === 'POOL_HOURS_INVALID' && server.writes === 0, 'invalid hours do not write');
  await server.send('poolHours.save', 'tenant-A', {
    opening_time: '10:00', closing_time: '19:00', expected_revision: null,
  });
  const stale = await server.send('poolHours.save', 'tenant-A', {
    opening_time: '11:00', closing_time: '20:00', expected_revision: null,
  });
  assert(stale.status === 409 && stale.body.code === 'POOL_HOURS_CONFLICT', 'stale revision maps to HTTP 409');
  assert(Number(server.writes) === 1 && server.rows.get('A')?.opening_time === '10:00', 'conflict preserves stored value');
});

Deno.test('read failure returns 503 rather than an unconfigured success', async () => {
  const server = fakeServer();
  server.setReadFailure(true);
  const response = await server.send('poolHours.get', 'tenant-A');
  assert(response.status === 503 && response.body.code === 'POOL_HOURS_READ_FAILED', 'read errors fail closed');
  assert(server.writes === 0, 'read failure cannot write');
});

Deno.test('pool writes default closed and require exact resolved tenant allowlist', async () => {
  const closed = fakeServer();
  const readable = await closed.send('poolHours.get', 'tenant-A');
  const denied = await closed.send('poolHours.save', 'tenant-A', {
    opening_time: '10:00', closing_time: '19:00', expected_revision: null,
  });
  assert(readable.status === 200, 'read remains available');
  assert(denied.status === 403 && denied.body.code === 'POOL_HOURS_WRITE_DISABLED', 'save fails closed');
  assert(closed.writes === 0 && closed.accessCreated === 1, 'denied save does not construct database access');

  const restricted = fakeServer('true', 'A');
  const forged = await restricted.send('poolHours.save', 'tenant-B', {
    client_id: 'A', opening_time: '10:00', closing_time: '19:00', expected_revision: null,
  });
  assert(forged.status === 403 && restricted.writes === 0 && restricted.accessCreated === 0, 'body tenant cannot bypass the allowlist');
});

Deno.test('pool writes require an authorized profile role even for an allowlisted tenant', async () => {
  const server = fakeServer('true', 'A');
  const denied = await server.send('poolHours.save', 'tenant-A-manager', {
    opening_time: '10:00', closing_time: '19:00', expected_revision: null,
  });
  assert(denied.status === 403 && denied.body.code === 'FORBIDDEN', 'manager profile cannot write pool rules');
  assert(server.writes === 0 && server.accessCreated === 0, 'role denial occurs before database access');
});
