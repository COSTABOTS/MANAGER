import { classifyWeeklyHoursRpcError, normalizeWeeklyRules, readWeeklyHours, saveWeeklyHours, weeklyHoursHttpStatus, type WeeklyHourRule, type WeeklyHoursAccess } from './weeklyHoursActions.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rules(): WeeklyHourRule[] {
  return Array.from({ length: 7 }, (_, weekday) => (['DESAYUNO', 'ALMUERZO', 'CENA'] as const).map((service) => ({
    weekday, service, enabled: weekday === 0 && service === 'ALMUERZO',
    start_time: weekday === 0 && service === 'ALMUERZO' ? '11:00' : null,
    end_time: weekday === 0 && service === 'ALMUERZO' ? '18:00' : null,
  }))).flat();
}

async function mockRevision(rows: WeeklyHourRule[]) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function mockAccess() {
  const tenants = new Map<string, WeeklyHourRule[]>();
  const calls = { read: [] as string[], replace: [] as string[] };
  let failRead = false;
  let failReplace = false;
  const access: WeeklyHoursAccess = {
    async read(clientId) {
      calls.read.push(clientId);
      const rows = structuredClone(tenants.get(clientId) ?? []);
      return { rows, revision: await mockRevision(rows), error: failRead };
    },
    async replace(clientId, next, expectedRevision) {
      calls.replace.push(clientId);
      if (failReplace) return { revision: null, error: 'server' };
      if (expectedRevision !== await mockRevision(tenants.get(clientId) ?? [])) return { revision: null, error: 'conflict' };
      tenants.set(clientId, structuredClone(next));
      return { revision: await mockRevision(next), error: null };
    },
  };
  return { access, tenants, calls, setFailRead: (value: boolean) => { failRead = value; }, setFailReplace: (value: boolean) => { failReplace = value; } };
}

Deno.test('21 rules round-trip with Sunday zero and exclusive end preserved', async () => {
  const db = mockAccess();
  const empty = await readWeeklyHours(db.access, 'A');
  assert(empty.ok && empty.rules.length === 0, 'initial read must be empty');
  const saved = await saveWeeklyHours(db.access, 'A', rules(), empty.revision);
  assert(saved.ok && saved.rules.length === 21, 'all rules must be saved');
  assert(saved.rules.find((row) => row.weekday === 0 && row.service === 'ALMUERZO')?.end_time === '18:00', 'Sunday lunch end must remain 18:00');
  assert(db.calls.replace.length === 1, 'single atomic RPC call required');
  assert((await readWeeklyHours(db.access, 'B')).ok, 'other tenant read must work');
  assert(db.tenants.has('B') === false, 'tenant B must remain untouched');
});

Deno.test('20, 22, duplicate, invalid weekday, bad service and inverted times are rejected before RPC', async () => {
  const db = mockAccess();
  const revision = await mockRevision([]);
  const valid = rules();
  const invalid = [
    valid.slice(0, 20), [...valid, valid[0]],
    [...valid.slice(0, 20), valid[0]],
    valid.map((row, i) => i === 0 ? { ...row, weekday: 7 } : row),
    valid.map((row, i) => i === 0 ? { ...row, service: 'BALINESA' } : row),
    valid.map((row) => row.weekday === 0 && row.service === 'ALMUERZO' ? { ...row, start_time: '18:00', end_time: '11:00' } : row),
  ];
  for (const candidate of invalid) {
    assert(normalizeWeeklyRules(candidate) === null, 'invalid rules must not normalize');
    const result = await saveWeeklyHours(db.access, 'A', candidate, revision);
    assert(!result.ok && result.code === 'WEEKLY_HOURS_INVALID', 'invalid rules must be rejected');
  }
  assert(db.calls.replace.length === 0, 'no invalid request may reach RPC');
});

Deno.test('a stale revision is rejected without overwriting newer remote data', async () => {
  const db = mockAccess();
  const emptyRevision = await mockRevision([]);
  const first = await saveWeeklyHours(db.access, 'A', rules(), emptyRevision);
  assert(first.ok, 'initial save must pass');
  const stale = await saveWeeklyHours(db.access, 'A', rules(), emptyRevision);
  assert(!stale.ok && stale.code === 'WEEKLY_HOURS_CONFLICT', 'stale save must conflict');
  assert(weeklyHoursHttpStatus(stale.code) === 409, 'conflict must produce HTTP 409');
  assert(db.calls.replace.length === 2, 'both requests must reach the atomic RPC; only one may write');
});

Deno.test('read and RPC failures do not report success or modify other tenant', async () => {
  const db = mockAccess();
  db.setFailRead(true);
  const read = await readWeeklyHours(db.access, 'A');
  assert(!read.ok && read.code === 'WEEKLY_HOURS_READ_FAILED', 'read error must be visible');
  const noWrite = await saveWeeklyHours(db.access, 'A', rules(), await mockRevision([]));
  assert(noWrite.ok && db.calls.read.length === 1, 'save must use atomic RPC without a separate preflight read');
  db.setFailRead(false);
  db.setFailReplace(true);
  const failed = await saveWeeklyHours(db.access, 'A', rules(), await mockRevision(rules()));
  assert(!failed.ok && failed.code === 'WEEKLY_HOURS_SAVE_FAILED', 'RPC error must be visible');
  assert(db.tenants.size === 1, 'failed RPC must retain prior data in mock');
});

Deno.test('PostgreSQL HH:mm:ss normalizes to the same rules as HH:mm', () => {
  const short = normalizeWeeklyRules(rules());
  const long = normalizeWeeklyRules(rules().map((row) => ({ ...row, start_time: row.start_time && `${row.start_time}:00`, end_time: row.end_time && `${row.end_time}:00` })));
  assert(short !== null && long !== null, 'both formats must parse');
  assert(JSON.stringify(short) === JSON.stringify(long), 'time format must normalize before returning to the editor');
});

Deno.test('the API uses the revision returned by the atomic RPC without a second read', async () => {
  const db = mockAccess();
  const result = await saveWeeklyHours(db.access, 'A', rules(), await mockRevision([]));
  assert(result.ok && result.revision === await mockRevision(rules()), 'revision must come from the atomic write');
  assert(db.calls.replace.length === 1, 'RPC must be called only once without retry');
  assert(db.calls.read.length === 0, 'save must not make a separate read');
});

Deno.test('PostgREST conflict is distinct from invalid input and internal errors', () => {
  assert(classifyWeeklyHoursRpcError({ code: 'P0001', message: 'WEEKLY_HOURS_CONFLICT' }) === 'conflict', 'conflict must map to HTTP 409');
  assert(classifyWeeklyHoursRpcError({ code: 'P0001', message: 'WEEKLY_HOURS_REQUIRES_21_UNIQUE_RULES' }) === 'invalid', 'invalid rules must be distinct');
  assert(classifyWeeklyHoursRpcError({ code: '42501', message: 'permission denied' }) === 'server', 'SQL details must not be exposed');
});
