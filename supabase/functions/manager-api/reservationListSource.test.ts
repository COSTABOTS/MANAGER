import assert from 'node:assert/strict';
import test from 'node:test';
import { readOfficialReservationList } from './reservationListSource.ts';
import type { ReservationRecord } from '../_shared/reservation-store/types.ts';

function reservation(id: string): ReservationRecord {
  return { id, date: '03/08/2026', time: '20:00', name: '', phone: '', pax: 2,
    language: 'ES', specialRequest: '', status: 'CONFIRMADA', origin: 'MANUAL',
    table: '', arrived: false, feedbackSent: false, room: '', service: 'CENA',
    balinesePackage: '', resource: '' };
}

function harness(store: string, shadow: boolean) {
  const calls = { sheets: 0, supabase: 0, shadow: 0 };
  return { calls, options: { reservationStore: store, reservationShadowRead: shadow,
    readSheets: async () => { calls.sheets++; return [reservation('SHEETS-1')]; },
    readSupabase: async () => { calls.supabase++; return [reservation('SUPABASE-1'), reservation('SUPABASE-2')]; },
    runShadow: async () => { calls.shadow++; },
  } };
}

test('sheets/false returns Sheets without shadow', async () => {
  const h = harness('sheets', false);
  assert.equal((await readOfficialReservationList(h.options))[0].id, 'SHEETS-1');
  assert.deepEqual(h.calls, { sheets: 1, supabase: 0, shadow: 0 });
});

test('sheets/true returns Sheets and executes shadow', async () => {
  const h = harness('sheets', true);
  assert.equal((await readOfficialReservationList(h.options))[0].id, 'SHEETS-1');
  assert.deepEqual(h.calls, { sheets: 1, supabase: 0, shadow: 1 });
});

test('supabase/false returns Supabase without Sheets or shadow', async () => {
  const h = harness('supabase', false);
  assert.equal((await readOfficialReservationList(h.options)).length, 2);
  assert.deepEqual(h.calls, { sheets: 0, supabase: 1, shadow: 0 });
});

test('supabase/true still skips Sheets and shadow', async () => {
  const h = harness('supabase', true);
  assert.equal((await readOfficialReservationList(h.options)).length, 2);
  assert.deepEqual(h.calls, { sheets: 0, supabase: 1, shadow: 0 });
});

test('supabase official failure propagates without fallback', async () => {
  const h = harness('supabase', false);
  h.options.readSupabase = async () => { h.calls.supabase++; throw new Error('SUPABASE_READ_FAILED'); };
  await assert.rejects(() => readOfficialReservationList(h.options), /SUPABASE_READ_FAILED/);
  assert.deepEqual(h.calls, { sheets: 0, supabase: 1, shadow: 0 });
});

test('Safari sheets configuration remains on Sheets', async () => {
  const h = harness('sheets', false);
  await readOfficialReservationList(h.options);
  assert.deepEqual(h.calls, { sheets: 1, supabase: 0, shadow: 0 });
});
