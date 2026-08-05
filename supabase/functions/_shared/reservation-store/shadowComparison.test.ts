import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compareAvailabilityResults,
  runAvailabilityShadow,
  type AvailabilityShadowEvent,
} from './shadowComparison.ts';
import type { AvailabilityResult } from './types.ts';

const sheets: AvailabilityResult = {
  requestedPax: 2,
  availableTimes: ['19:00', '20:00'],
  requestedTimeAvailable: true,
};

test('shadow_read=false never invokes Supabase or emits an event', async () => {
  let calls = 0;
  const events: AvailabilityShadowEvent[] = [];
  await runAvailabilityShadow({
    enabled: false,
    requestId: 'request-safe',
    clientId: 'CB-DEMO-002',
    sheetsResult: sheets,
    readSupabase: async () => { calls += 1; return sheets; },
    log: (event) => events.push(event),
  });
  assert.equal(calls, 0);
  assert.equal(events.length, 0);
});
test('matching shadow leaves the official Sheets result unchanged', async () => {
  const official = structuredClone(sheets);
  const before = structuredClone(official);
  const events: AvailabilityShadowEvent[] = [];
  await runAvailabilityShadow({
    enabled: true,
    requestId: 'request-safe',
    clientId: 'CB-DEMO-002',
    sheetsResult: official,
    readSupabase: async () => structuredClone(sheets),
    log: (event) => events.push(event),
  });
  assert.deepEqual(official, before);
  assert.equal(events[0]?.shadow_status, 'ok');
  assert.equal(events[0]?.match, true);
});

test('mismatch leaves the official Sheets result unchanged', async () => {
  const official = structuredClone(sheets);
  const before = structuredClone(official);
  const events: AvailabilityShadowEvent[] = [];
  await runAvailabilityShadow({
    enabled: true,
    requestId: 'request-safe',
    clientId: 'CB-DEMO-002',
    sheetsResult: official,
    readSupabase: async () => ({ ...sheets, availableTimes: ['19:00'] }),
    log: (event) => events.push(event),
  });
  assert.deepEqual(official, before);
  assert.equal(events[0]?.shadow_status, 'mismatch');
  assert.equal(events[0]?.missing_count, 1);
});

test('Supabase failure is isolated and sanitized', async () => {
  const official = structuredClone(sheets);
  const events: AvailabilityShadowEvent[] = [];
  await runAvailabilityShadow({
    enabled: true,
    requestId: 'request-safe',
    clientId: 'CB-DEMO-002',
    sheetsResult: official,
    readSupabase: async () => { throw new Error('phone=600000000 token=secret'); },
    log: (event) => events.push(event),
  });
  assert.deepEqual(official, sheets);
  assert.equal(events[0]?.error_code, 'SHADOW_READ_FAILED');
  assert.ok(!JSON.stringify(events).includes('600000000'));
  assert.ok(!JSON.stringify(events).includes('secret'));
});

test('shadow timeout is isolated and does not modify Sheets', async () => {
  const official = structuredClone(sheets);
  const events: AvailabilityShadowEvent[] = [];
  await runAvailabilityShadow({
    enabled: true,
    requestId: 'request-safe',
    clientId: 'CB-DEMO-002',
    sheetsResult: official,
    readSupabase: () => new Promise(() => {}),
    timeoutMs: 5,
    log: (event) => events.push(event),
  });
  assert.deepEqual(official, sheets);
  assert.equal(events[0]?.error_code, 'SHADOW_TIMEOUT');
});

test('comparison normalizes and sorts times before comparing', () => {
  assert.deepEqual(compareAvailabilityResults(sheets, {
    requestedPax: 2,
    availableTimes: ['20:00:00', '19:00'],
    requestedTimeAvailable: true,
  }), {
    match: true,
    sheets_count: 2,
    supabase_count: 2,
    requested_time_match: true,
    missing_in_supabase_count: 0,
    extra_in_supabase_count: 0,
  });
});

test('comparison counts missing and extra slots without exposing their values', () => {
  const result = compareAvailabilityResults(sheets, {
    requestedPax: 2,
    availableTimes: ['20:00', '21:00'],
    requestedTimeAvailable: false,
  });
  assert.equal(result.match, false);
  assert.equal(result.missing_in_supabase_count, 1);
  assert.equal(result.extra_in_supabase_count, 1);
  assert.equal(result.requested_time_match, false);
  assert.ok(!JSON.stringify(result).includes('19:00'));
  assert.ok(!JSON.stringify(result).includes('21:00'));
});

test('Safari with shadow false never invokes Supabase', async () => {
  let calls = 0;
  await runAvailabilityShadow({
    enabled: false,
    requestId: 'request-safe',
    clientId: 'CB-SAFARI-001',
    sheetsResult: sheets,
    readSupabase: async () => { calls += 1; return sheets; },
  });
  assert.equal(calls, 0);
});

test('HTTP response remains legacy-only and internal client flags are not exposed', () => {
  const route = readFileSync(
    new URL('../../public-api/routes/availabilityByHour.ts', import.meta.url),
    'utf8',
  );
  const responseBlock = route.slice(route.indexOf('return jsonResponse(request, {'));
  for (const internal of ['reservation_store', 'reservation_shadow_read', 'shadow_status', 'sheets_count', 'supabase_count']) {
    assert.ok(!responseBlock.includes(internal), internal);
  }
  assert.match(responseBlock, /pax_solicitados: result\.requestedPax/);
  assert.match(responseBlock, /horas_disponibles: result\.availableTimes/);
  assert.match(responseBlock, /DISPONIBLE: result\.requestedTimeAvailable/);
  assert.match(route, /reservationStore: 'sheets'/);
  const clients = readFileSync(new URL('../../public-api/lib/clients.ts', import.meta.url), 'utf8');
  assert.match(clients, /reservation_shadow_read/);
  assert.match(clients, /reservationShadowRead:.*=== true/);
});
