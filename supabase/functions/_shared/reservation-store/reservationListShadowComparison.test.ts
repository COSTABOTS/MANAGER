import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compareReservationLists,
  runReservationListShadow,
  type ReservationListShadowEvent,
} from './reservationListShadowComparison.ts';
import type { ReservationRecord } from './types.ts';

function reservation(id: string, overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    id,
    date: '17/08/2026',
    time: '20:00',
    name: 'Synthetic Guest',
    phone: '600000000',
    pax: 2,
    language: 'ES',
    specialRequest: 'private request',
    status: 'CONFIRMADA',
    origin: 'BOT',
    table: 'S1',
    arrived: false,
    feedbackSent: false,
    room: 'PRIVATE-ROOM',
    service: 'CENA',
    balinesePackage: '',
    resource: '',
    sourceChannel: 'sheets',
    ...overrides,
  };
}

test('shadow_read=false never reads Supabase or logs', async () => {
  let reads = 0;
  const events: ReservationListShadowEvent[] = [];
  const sheets = [reservation('RES-1')];
  const official = await runReservationListShadow({
    enabled: false,
    requestId: 'request-disabled',
    clientId: 'CB-DEMO-002',
    sheetsReservations: sheets,
    readSupabase: async () => { reads += 1; return []; },
    log: (event) => events.push(event),
  });
  assert.equal(official, sheets);
  assert.equal(reads, 0);
  assert.deepEqual(events, []);
});

test('complete match preserves the official Sheets array', async () => {
  const sheets = [reservation('RES-1'), reservation('RES-2')];
  const events: ReservationListShadowEvent[] = [];
  const official = await runReservationListShadow({
    enabled: true,
    requestId: 'request-match',
    clientId: 'CB-DEMO-002',
    sheetsReservations: sheets,
    readSupabase: async () => sheets.map((row) => ({ ...row })),
    log: (event) => events.push(event),
  });
  assert.equal(official, sheets);
  assert.deepEqual(events[0] && {
    match: events[0].match,
    sheets: events[0].sheets_count,
    supabase: events[0].supabase_count,
    matched: events[0].matched_count,
    status: events[0].shadow_status,
  }, { match: true, sheets: 2, supabase: 2, matched: 2, status: 'ok' });
});

test('a reservation absent from Supabase is counted without exposing its id', () => {
  const result = compareReservationLists([reservation('SECRET-ID-1')], []);
  assert.equal(result.match, false);
  assert.equal(result.missing_in_supabase_count, 1);
  assert.equal(JSON.stringify(result).includes('SECRET-ID-1'), false);
});

test('an extra Supabase reservation is counted', () => {
  const result = compareReservationLists([], [reservation('RES-EXTRA')]);
  assert.equal(result.extra_in_supabase_count, 1);
  assert.equal(result.match, false);
});

test('every approved comparable field can produce a sanitized difference', () => {
  const cases: Array<[keyof ReservationRecord, unknown]> = [
    ['date', '18/08/2026'], ['time', '20:30'], ['pax', 3], ['status', 'CANCELADA'],
    ['language', 'EN'], ['origin', 'MANUAL'], ['table', 'S2'], ['resource', 'B1'],
    ['service', 'ALMUERZO'], ['arrived', true], ['feedbackSent', true], ['room', 'OTHER'],
    ['balinesePackage', 'PACK-1'],
  ];
  for (const [field, value] of cases) {
    const result = compareReservationLists(
      [reservation('RES-1')],
      [reservation('RES-1', { [field]: value })],
    );
    assert.equal(result.different_count, 1, String(field));
    assert.equal(result.match, false, String(field));
  }
});

test('array order does not affect comparison', () => {
  const sheets = [reservation('RES-1'), reservation('RES-2')];
  const result = compareReservationLists(sheets, [...sheets].reverse());
  assert.equal(result.match, true);
  assert.equal(result.matched_count, 2);
});

test('only temporary source_channel=demo fixtures are excluded', () => {
  const sheets = [reservation('RES-1')];
  const result = compareReservationLists(sheets, [
    reservation('RES-1'),
    reservation('FIXTURE', { sourceChannel: 'demo' }),
    reservation('OTHER', { sourceChannel: 'widget', origin: 'DEMO' }),
  ]);
  assert.equal(result.supabase_count, 2);
  assert.equal(result.extra_in_supabase_count, 1);
});

test('Supabase failure is isolated and sanitized', async () => {
  const events: ReservationListShadowEvent[] = [];
  const sheets = [reservation('RES-1')];
  const official = await runReservationListShadow({
    enabled: true,
    requestId: 'request-failure',
    clientId: 'CB-DEMO-002',
    sheetsReservations: sheets,
    readSupabase: async () => { throw new Error('database row contains private data'); },
    log: (event) => events.push(event),
  });
  assert.equal(official, sheets);
  assert.equal(events[0]?.error_code, 'SHADOW_READ_FAILED');
  assert.equal(JSON.stringify(events).includes('private data'), false);
});

test('timeout is isolated from the official response', async () => {
  const events: ReservationListShadowEvent[] = [];
  const sheets = [reservation('RES-1')];
  const official = await runReservationListShadow({
    enabled: true,
    requestId: 'request-timeout',
    clientId: 'CB-DEMO-002',
    sheetsReservations: sheets,
    readSupabase: () => new Promise(() => undefined),
    timeoutMs: 5,
    log: (event) => events.push(event),
  });
  assert.equal(official, sheets);
  assert.equal(events[0]?.error_code, 'SHADOW_TIMEOUT');
  assert.equal(events[0]?.shadow_status, 'error');
});

test('Manager and Supabase reads remain isolated by effective client_id', () => {
  const manager = readFileSync(new URL('../../manager-api/index.ts', import.meta.url), 'utf8');
  const store = readFileSync(new URL('./supabaseReservationStore.ts', import.meta.url), 'utf8');
  assert.match(manager, /clientId,\s*sheetId,\s*reservationStore: 'supabase'/);
  assert.match(store, /\.eq\('client_id', this\.context\.clientId\)/);
  assert.doesNotMatch(manager, /CB-DEMO-002|CB-SAFARI-001/);
});

test('Manager response uses the selected official source and exposes no routing internals', () => {
  const manager = readFileSync(new URL('../../manager-api/index.ts', import.meta.url), 'utf8');
  const listFunction = manager.slice(
    manager.indexOf('async function listReservations('),
    manager.indexOf('async function listCapacity('),
  );
  assert.match(listFunction, /readOfficialReservationList/);
  assert.match(listFunction, /reservationStore: String\(reservationStore \|\| 'sheets'\)/);
  assert.match(listFunction, /const reservations = officialReservations\.map\(toManagerReservation\)/);
  assert.doesNotMatch(listFunction, /reservation_store\s*:/);
  assert.doesNotMatch(listFunction, /shadow_status\s*:/);
  assert.doesNotMatch(listFunction, /sourceChannel\s*:/);
});

test('structured events contain only approved aggregate fields and no PII or token', async () => {
  const events: ReservationListShadowEvent[] = [];
  await runReservationListShadow({
    enabled: true,
    requestId: 'request-safe-log',
    clientId: 'CB-DEMO-002',
    sheetsReservations: [reservation('PRIVATE-ID')],
    readSupabase: async () => [reservation('PRIVATE-ID')],
    log: (event) => events.push(event),
  });
  assert.deepEqual(Object.keys(events[0] ?? {}).sort(), [
    'client_id', 'created_at', 'different_count', 'error_code', 'extra_count',
    'latency_ms', 'match', 'matched_count', 'missing_count', 'operation',
    'request_id', 'shadow_status', 'sheets_count', 'supabase_count',
  ].sort());
  const serialized = JSON.stringify(events);
  for (const forbidden of ['Synthetic Guest', '600000000', 'private request', 'PRIVATE-ROOM', 'PRIVATE-ID']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('Safari with shadow flag false never executes a read', async () => {
  let called = false;
  await runReservationListShadow({
    enabled: false,
    requestId: 'request-safari',
    clientId: 'CB-SAFARI-001',
    sheetsReservations: [],
    readSupabase: async () => { called = true; return []; },
  });
  assert.equal(called, false);
});
