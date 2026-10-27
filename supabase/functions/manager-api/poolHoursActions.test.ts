import {
  classifyPoolHoursRpcError,
  executePoolHoursAction,
  normalizePoolHoursSnapshot,
  poolHoursHttpStatus,
  type PoolHoursAccess,
  type PoolHoursSnapshot,
} from './poolHoursActions.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const empty: PoolHoursSnapshot = {
  configured: false, opening_time: null, closing_time: null,
  time_zone: 'Europe/Madrid', revision: null,
};
const revisionA = '11111111-1111-4111-8111-111111111111';
const revisionB = '22222222-2222-4222-8222-222222222222';

function fakeAccess() {
  const rows = new Map<string, PoolHoursSnapshot>();
  const calls: string[] = [];
  let serial = 0;
  const access: PoolHoursAccess = {
    async read(clientId) {
      calls.push(`read:${clientId}`);
      return { data: rows.get(clientId) ?? empty, error: null };
    },
    async replace(clientId, openingTime, closingTime, expectedRevision) {
      calls.push(`replace:${clientId}`);
      const current = rows.get(clientId) ?? empty;
      if (current.revision !== expectedRevision) {
        return { data: null, error: { code: 'P0001', message: 'POOL_HOURS_CONFLICT' } };
      }
      serial += 1;
      const next: PoolHoursSnapshot = {
        configured: true, opening_time: openingTime, closing_time: closingTime,
        time_zone: 'Europe/Madrid', revision: serial === 1 ? revisionA : revisionB,
      };
      rows.set(clientId, next);
      return { data: next, error: null };
    },
  };
  return { access, rows, calls };
}

Deno.test('unconfigured tenant has no invented hours or revision', async () => {
  const { access } = fakeAccess();
  const result = await executePoolHoursAction(access, 'poolHours.get', 'A', {});
  assert(result.ok && !result.snapshot.configured && result.snapshot.opening_time === null && result.snapshot.revision === null, 'read must remain unconfigured');
});

Deno.test('save and read use authenticated tenant, ignoring a forged body client_id', async () => {
  const { access, rows, calls } = fakeAccess();
  const result = await executePoolHoursAction(access, 'poolHours.save', 'A', {
    client_id: 'B', opening_time: '10:00', closing_time: '19:00', expected_revision: null,
  });
  assert(result.ok && result.snapshot.revision === revisionA, 'first write returns its revision');
  assert(rows.get('A')?.opening_time === '10:00' && !rows.has('B'), 'only the authenticated tenant is written');
  const read = await executePoolHoursAction(access, 'poolHours.get', 'A', { client_id: 'B' });
  assert(read.ok && read.snapshot.closing_time === '19:00', 'read returns authenticated tenant');
  assert(calls.join('|') === 'replace:A|read:A', 'no cross-tenant call is made');
});

Deno.test('invalid, empty, equal and inverted times never call persistence', async () => {
  const { access, calls } = fakeAccess();
  for (const [opening_time, closing_time] of [['', '19:00'], ['19:00', '19:00'], ['20:00', '10:00'], ['25:00', '26:00']]) {
    const result = await executePoolHoursAction(access, 'poolHours.save', 'A', { opening_time, closing_time, expected_revision: null });
    assert(!result.ok && result.code === 'POOL_HOURS_INVALID' && poolHoursHttpStatus(result.code) === 400, 'bad hours must be HTTP 400');
  }
  assert(calls.length === 0, 'invalid input never reaches the store');
});

Deno.test('stale revision and competing saves produce a conflict without overwriting', async () => {
  const { access, rows } = fakeAccess();
  const first = await executePoolHoursAction(access, 'poolHours.save', 'A', {
    opening_time: '10:00', closing_time: '19:00', expected_revision: null,
  });
  assert(first.ok, 'first save must pass');
  const [winner, loser] = await Promise.all([
    executePoolHoursAction(access, 'poolHours.save', 'A', { opening_time: '09:00', closing_time: '18:00', expected_revision: revisionA }),
    executePoolHoursAction(access, 'poolHours.save', 'A', { opening_time: '11:00', closing_time: '20:00', expected_revision: revisionA }),
  ]);
  assert(winner.ok && !loser.ok && loser.code === 'POOL_HOURS_CONFLICT', 'exactly one revision wins');
  assert(!loser.ok && poolHoursHttpStatus(loser.code) === 409, 'stale revision maps to HTTP 409');
  assert(rows.get('A')?.opening_time === '09:00', 'loser cannot overwrite winner');
});

Deno.test('real read errors and malformed stored configuration fail closed', async () => {
  const failed: PoolHoursAccess = {
    read: async () => ({ data: null, error: { message: 'DB_ERROR' } }),
    replace: async () => ({ data: null, error: { message: 'DB_ERROR' } }),
  };
  const read = await executePoolHoursAction(failed, 'poolHours.get', 'A', {});
  assert(!read.ok && read.code === 'POOL_HOURS_READ_FAILED', 'read failure must not look unconfigured');
  const save = await executePoolHoursAction(failed, 'poolHours.save', 'A', { opening_time: '10:00', closing_time: '19:00', expected_revision: null });
  assert(!save.ok && save.code === 'POOL_HOURS_SAVE_FAILED', 'server failure must not report success');
  assert(normalizePoolHoursSnapshot({ ...empty, configured: true, opening_time: '10:00', closing_time: '19:00', revision: revisionA, time_zone: 'UTC' }) === null, 'wrong timezone is rejected');
  assert(classifyPoolHoursRpcError({ code: 'P0001', message: 'POOL_HOURS_CONFLICT' }) === 'conflict', 'exact SQL code is recognized');
  assert(classifyPoolHoursRpcError({ code: 'P0001', message: 'something else' }) === 'server', 'unexpected SQL error stays internal');
});
