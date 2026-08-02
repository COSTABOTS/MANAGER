import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../../migrations/20260802223000_hospitality_reservation_write_rpc.sql', import.meta.url), 'utf8');
const manager = await readFile(new URL('../../manager-api/index.ts', import.meta.url), 'utf8');
const publicCreate = await readFile(new URL('../../public-api/routes/reservationCreate.ts', import.meta.url), 'utf8');

test('public create uses the transactional RPC and never deletes', () => {
  assert(migration.includes('create_hospitality_reservation'));
  assert(migration.includes('pg_advisory_xact_lock'));
  assert(migration.includes("operation='reservation.create'"));
  assert.equal(/\bdelete\s+from\b/i.test(migration), false);
});

test('RPC is service-role only and revalidates capacity', () => {
  assert(migration.includes('revoke all on function'));
  assert(migration.includes('grant execute on function public.create_hospitality_reservation(text,text,jsonb) to service_role'));
  assert(migration.includes('AVAILABILITY_EXHAUSTED'));
  assert(migration.includes("status in ('confirmed','pending')"));
});

test('manager routes all six approved mutations through store selection', () => {
  for (const operation of ['createManualReservation','createWalkIn','cancelReservation','updateArrival','assignTable']) {
    assert(manager.includes(`store.${operation}`));
  }
  assert(publicCreate.includes('store.createReservation(command)'));
});

test('no automatic Sheets fallback follows a Supabase mutation', () => {
  assert.equal(manager.includes("reservationStore).toLowerCase() === 'supabase'"), true);
  assert.equal(publicCreate.includes('fallback'), false);
});
