import { handleWeeklyHoursHttp, type WeeklyHoursAuthContext, type WeeklyHoursResponseWriters } from './weeklyHoursHttp.ts';
import type { WeeklyHourRule, WeeklyHoursAccess } from './weeklyHoursActions.ts';
import { canWriteRemoteHours } from './hoursWriteGate.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const emptyRevision = '0'.repeat(64);
const savedRevision = '1'.repeat(64);
const rules: WeeklyHourRule[] = Array.from({ length: 7 }, (_, weekday) =>
  (['DESAYUNO', 'ALMUERZO', 'CENA'] as const).map((service) => ({
    weekday, service, enabled: false, start_time: null, end_time: null,
  }))).flat();

function fakeServer(enabled?: string, allowedClientIds?: string) {
  const rows = new Map<string, WeeklyHourRule[]>();
  let writes = 0;
  let accessCreated = 0;
  let readFailure = false;
  const access: WeeklyHoursAccess = {
    async read(clientId) {
      return { rows: rows.get(clientId) ?? [], revision: rows.has(clientId) ? savedRevision : emptyRevision, error: readFailure };
    },
    async replace(clientId, next, expectedRevision) {
      const currentRevision = rows.has(clientId) ? savedRevision : emptyRevision;
      if (expectedRevision !== currentRevision) return { revision: null, error: 'conflict' };
      writes += 1;
      rows.set(clientId, structuredClone(next));
      return { revision: savedRevision, error: null };
    },
  };
  const respond: WeeklyHoursResponseWriters = {
    success: (_request, payload) => Response.json(payload),
    failure: (_request, code, status) => Response.json({ ok: false, code }, { status }),
  };
  async function send(action: 'weeklyHours.get' | 'weeklyHours.save', token: string, payload: Record<string, unknown> = {}) {
    const request = new Request('https://manager-api.invalid/', {
      method: 'POST', headers: { Authorization: token }, body: JSON.stringify({ action, ...payload }),
    });
    const authorize = async (incoming: Request): Promise<WeeklyHoursAuthContext | Response | null> => {
      const identity = incoming.headers.get('Authorization');
      return identity === 'tenant-A' ? { clientId: 'A', role: 'ADMIN', serviceRoleAvailable: true }
        : identity === 'tenant-B' ? { clientId: 'B', role: 'ADMIN', serviceRoleAvailable: true }
        : identity === 'tenant-A-manager' ? { clientId: 'A', role: 'MANAGER', serviceRoleAvailable: true }
        : identity === 'no-service-role' ? { clientId: 'A', role: 'ADMIN', serviceRoleAvailable: false }
        : respond.failure(incoming, 'UNAUTHENTICATED', 401);
    };
    const response = await handleWeeklyHoursHttp(request, { action, ...payload }, action, authorize, () => {
      accessCreated += 1;
      return access;
    }, respond, (clientId) => canWriteRemoteHours(clientId, enabled, allowedClientIds));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  return { send, rows, get writes() { return writes; }, get accessCreated() { return accessCreated; }, setReadFailure(value: boolean) { readFailure = value; } };
}

Deno.test('weekly HTTP read/save use server tenant, never forged browser client_id', async () => {
  const server = fakeServer('true', 'A');
  const first = await server.send('weeklyHours.get', 'tenant-A', { client_id: 'B' });
  assert(first.status === 200 && first.body.client_id === 'A' && first.body.revision === emptyRevision, 'A reads its own empty snapshot');
  const saved = await server.send('weeklyHours.save', 'tenant-A', { client_id: 'B', rules, expected_revision: emptyRevision });
  assert(saved.status === 200 && saved.body.client_id === 'A' && server.rows.has('A') && !server.rows.has('B'), 'forged tenant is ignored');
  const other = await server.send('weeklyHours.get', 'tenant-B', { client_id: 'A' });
  assert(other.status === 200 && other.body.client_id === 'B' && other.body.revision === emptyRevision, 'B cannot read A');
  assert(server.writes === 1, 'only the authorized tenant was written once');
});

Deno.test('weekly HTTP rejects missing auth and service role before access', async () => {
  const server = fakeServer();
  const missing = await server.send('weeklyHours.save', '', { rules, expected_revision: emptyRevision });
  const unavailable = await server.send('weeklyHours.get', 'no-service-role');
  assert(missing.status === 401 && missing.body.code === 'UNAUTHENTICATED', 'missing auth is rejected');
  assert(unavailable.status === 503 && unavailable.body.code === 'WEEKLY_HOURS_UNAVAILABLE', 'missing service role is rejected');
  assert(server.accessCreated === 0 && server.writes === 0, 'no database access before authorization');
});

Deno.test('weekly HTTP validates 21 rules and CAS without rejected writes', async () => {
  const server = fakeServer('true', 'A');
  const invalid = await server.send('weeklyHours.save', 'tenant-A', { rules: rules.slice(0, 20), expected_revision: emptyRevision });
  assert(invalid.status === 400 && invalid.body.code === 'WEEKLY_HOURS_INVALID' && server.writes === 0, '20 rules never write');
  await server.send('weeklyHours.save', 'tenant-A', { rules, expected_revision: emptyRevision });
  const stale = await server.send('weeklyHours.save', 'tenant-A', { rules, expected_revision: emptyRevision });
  assert(stale.status === 409 && stale.body.code === 'WEEKLY_HOURS_CONFLICT' && Number(server.writes) === 1, 'stale revision does not overwrite');
});

Deno.test('weekly HTTP read failure cannot become an empty successful configuration', async () => {
  const server = fakeServer();
  server.setReadFailure(true);
  const response = await server.send('weeklyHours.get', 'tenant-A');
  assert(response.status === 503 && response.body.code === 'WEEKLY_HOURS_READ_FAILED', 'read errors fail closed');
  assert(server.writes === 0, 'read failure cannot write');
});

Deno.test('weekly writes default closed and require exact resolved tenant allowlist', async () => {
  const closed = fakeServer();
  const readable = await closed.send('weeklyHours.get', 'tenant-A');
  const denied = await closed.send('weeklyHours.save', 'tenant-A', { rules, expected_revision: emptyRevision });
  assert(readable.status === 200, 'read remains available');
  assert(denied.status === 403 && denied.body.code === 'WEEKLY_HOURS_WRITE_DISABLED', 'save fails closed');
  assert(closed.writes === 0 && closed.accessCreated === 1, 'denied save does not construct database access');

  const restricted = fakeServer('true', 'A');
  const forged = await restricted.send('weeklyHours.save', 'tenant-B', {
    client_id: 'A', rules, expected_revision: emptyRevision,
  });
  assert(forged.status === 403 && restricted.writes === 0 && restricted.accessCreated === 0, 'body tenant cannot bypass the allowlist');
});

Deno.test('weekly writes require an authorized profile role even for an allowlisted tenant', async () => {
  const server = fakeServer('true', 'A');
  const denied = await server.send('weeklyHours.save', 'tenant-A-manager', { rules, expected_revision: emptyRevision });
  assert(denied.status === 403 && denied.body.code === 'FORBIDDEN', 'manager profile cannot write weekly rules');
  assert(server.writes === 0 && server.accessCreated === 0, 'role denial occurs before database access');
});
