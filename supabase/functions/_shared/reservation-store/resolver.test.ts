import assert from 'node:assert/strict';
import test from 'node:test';
import { ReservationStoreNotEnabledError } from './errors.ts';
import { resolveReservationStore } from './resolver.ts';

const context = { clientId: 'CB-FIXTURE-001', sheetId: 'sheet-fixture' };

test('defaults a missing reservation_store to sheets', () => {
  const store = resolveReservationStore(context, {});
  assert.equal(store.name, 'sheets');
});

test('selects sheets explicitly', () => {
  const store = resolveReservationStore({ ...context, reservationStore: 'sheets' }, {});
  assert.equal(store.name, 'sheets');
});

test('does not enable the Supabase store', () => {
  assert.throws(
    () => resolveReservationStore({ ...context, reservationStore: 'supabase' }, {}),
    ReservationStoreNotEnabledError,
  );
});

test('delegates availability without changing order or values', async () => {
  const expected = {
    requestedPax: 2,
    availableTimes: ['19:30', '20:00', '20:30'],
    requestedTimeAvailable: true,
  };
  const store = resolveReservationStore(context, {
    getAvailability: async () => expected,
  });
  assert.deepEqual(await store.getAvailability({ date: '2026-08-15', requestedPax: 2, requestedTime: '20:00' }), expected);
});

test('delegates reservation creation and preserves id', async () => {
  const reservation = {
    id: 'RES-0000000000000-A1B2C3', date: '15/08/2026', time: '20:00',
    name: 'Cliente Ejemplo', phone: '+34600000000', pax: 2, language: 'ES',
    specialRequest: 'Sin datos reales', status: 'CONFIRMADA', origin: 'BOT', table: '',
    arrived: false, feedbackSent: false, room: '', service: 'CENA', balinesePackage: '', resource: '',
  };
  const store = resolveReservationStore(context, {
    createReservation: async (command) => ({ reservation: command }),
  });
  assert.deepEqual(await store.createReservation(reservation), { reservation });
});
