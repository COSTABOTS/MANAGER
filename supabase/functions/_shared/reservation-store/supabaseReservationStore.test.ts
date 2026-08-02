import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isReservationActiveForCapacity,
  SupabaseReservationStore,
  type SupabaseReadClient,
  type SupabaseReadQuery,
} from './supabaseReservationStore.ts';

type Row = Record<string, unknown>;

class FixtureQuery implements SupabaseReadQuery {
  private readonly rows: Row[];
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private maxRows: number | null = null;
  private single = false;

  constructor(rows: Row[]) { this.rows = rows; }

  select(): SupabaseReadQuery { return this; }
  eq(column: string, value: unknown): SupabaseReadQuery {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  is(column: string, value: null): SupabaseReadQuery {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]): SupabaseReadQuery {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): SupabaseReadQuery {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number): SupabaseReadQuery {
    this.maxRows = count;
    return this;
  }
  maybeSingle(): SupabaseReadQuery {
    this.single = true;
    return this;
  }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let result = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    result.sort((left, right) => {
      for (const order of this.orders) {
        const comparison = String(left[order.column] ?? '').localeCompare(String(right[order.column] ?? ''));
        if (comparison !== 0) return order.ascending ? comparison : -comparison;
      }
      return 0;
    });
    if (this.maxRows !== null) result = result.slice(0, this.maxRows);
    return Promise.resolve({ data: this.single ? result[0] ?? null : result, error: null }).then(onfulfilled, onrejected);
  }
}

class FixtureClient implements SupabaseReadClient {
  readonly calls: string[] = [];
  private readonly tables: Record<string, Row[]>;
  constructor(tables: Record<string, Row[]> = {}) { this.tables = tables; }
  from(table: string): SupabaseReadQuery {
    this.calls.push(table);
    return new FixtureQuery(this.tables[table] ?? []);
  }
}

class FailedQuery implements SupabaseReadQuery {
  constructor(privateMessage: string) { this.message = privateMessage; }
  private readonly message: string;
  select(): SupabaseReadQuery { return this; }
  eq(): SupabaseReadQuery { return this; }
  is(): SupabaseReadQuery { return this; }
  in(): SupabaseReadQuery { return this; }
  order(): SupabaseReadQuery { return this; }
  limit(): SupabaseReadQuery { return this; }
  maybeSingle(): SupabaseReadQuery { return this; }
  then<TResult1 = { data: null; error: { message: string } }, TResult2 = never>(
    onfulfilled?: ((value: { data: null; error: { message: string } }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: { message: this.message } }).then(onfulfilled, onrejected);
  }
}

class SelectiveFailureClient extends FixtureClient {
  private readonly failedTable: string;
  constructor(tables: Record<string, Row[]>, failedTable: string) {
    super(tables);
    this.failedTable = failedTable;
  }
  override from(table: string): SupabaseReadQuery {
    return table === this.failedTable ? new FailedQuery('synthetic database failure') : super.from(table);
  }
}

const context = { clientId: 'CB-FIXTURE-001', sheetId: '', reservationStore: 'supabase' };

function reservation(overrides: Row = {}): Row {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    client_id: context.clientId,
    legacy_reservation_id: 'RES-FIXTURE-001',
    public_reference: 'PUB-FIXTURE-001',
    booking_date: '2026-08-15',
    booking_time: '20:00:00',
    customer_name: 'Cliente Ejemplo',
    customer_phone: '600000000',
    pax: 2,
    locale: 'es',
    legacy_locale: null,
    special_request: 'Sin datos reales',
    status: 'confirmed',
    legacy_status: null,
    source_channel: 'typebot',
    legacy_source: null,
    table_id: null,
    resource_id: null,
    room: '',
    arrived: false,
    feedback_sent: false,
    service: 'cena',
    balinese_package: null,
    created_at: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

for (const fixture of [
  { name: 'status confirmed consumes capacity', row: { status: 'confirmed' } },
  { name: 'status pending consumes capacity', row: { status: 'pending' } },
  { name: 'legacy CONFIRMADA consumes capacity', row: { legacy_status: 'CONFIRMADA' } },
  { name: 'legacy CONFIRMED consumes capacity', row: { legacy_status: 'CONFIRMED' } },
]) {
  test(fixture.name, () => assert.equal(isReservationActiveForCapacity(fixture.row), true));
}

for (const fixture of [
  { name: 'status cancelled does not consume capacity', row: { status: 'cancelled' } },
  { name: 'status no_show does not consume capacity', row: { status: 'no_show' } },
  { name: 'legacy CANCELADA does not consume capacity', row: { legacy_status: 'CANCELADA' } },
  { name: 'other inactive states do not consume capacity', row: { status: 'completed', legacy_status: 'OTRO' } },
]) {
  test(fixture.name, () => assert.equal(isReservationActiveForCapacity(fixture.row), false));
}

for (const fixture of [
  { name: 'cancelled overrides legacy CONFIRMADA', row: { status: 'cancelled', legacy_status: 'CONFIRMADA' } },
  { name: 'no_show overrides legacy CONFIRMED', row: { status: 'no_show', legacy_status: 'CONFIRMED' } },
  { name: 'legacy CANCELADA overrides status confirmed', row: { status: 'confirmed', legacy_status: 'CANCELADA' } },
]) {
  test(fixture.name, () => assert.equal(isReservationActiveForCapacity(fixture.row), false));
}

test('empty Hospitality tables return valid empty read models', async () => {
  const store = new SupabaseReservationStore(context, new FixtureClient());
  assert.deepEqual(await store.getAvailability({ date: '15/08/2026', requestedPax: 2, requestedTime: '20:00' }), {
    requestedPax: 2,
    availableTimes: [],
    requestedTimeAvailable: false,
  });
  assert.deepEqual(await store.listReservations(), []);
  assert.equal(await store.getReservation('RES-NOT-FOUND'), null);
});

test('availability preserves slot order and counts every active status variant', async () => {
  const client = new FixtureClient({
    booking_capacity_slots: [
      { client_id: context.clientId, slot_time: '19:30:00', capacity: 4, active: true, service: null, weekday: null, valid_from: null, valid_until: null },
      { client_id: context.clientId, slot_time: '20:00:00', capacity: 8, active: true, service: null, weekday: null, valid_from: null, valid_until: null },
      { client_id: 'CB-OTHER', slot_time: '18:00:00', capacity: 99, active: true, service: null, weekday: null, valid_from: null, valid_until: null },
    ],
    reservations: [
      reservation({ booking_time: '19:30:00', status: 'confirmed', legacy_status: null, pax: 2 }),
      reservation({ id: '10000000-0000-4000-8000-000000000002', booking_time: '19:30:00', status: 'pending', pax: 1 }),
      reservation({ id: '10000000-0000-4000-8000-000000000003', booking_time: '20:00:00', status: 'legacy_unknown', legacy_status: 'CONFIRMADA', pax: 2 }),
      reservation({ id: '10000000-0000-4000-8000-000000000004', booking_time: '20:00:00', status: 'legacy_unknown', legacy_status: 'CONFIRMED', pax: 2 }),
      reservation({ id: '10000000-0000-4000-8000-000000000005', booking_time: '20:00:00', status: 'cancelled', legacy_status: 'CONFIRMADA', pax: 99 }),
      reservation({ id: '10000000-0000-4000-8000-000000000007', booking_time: '20:00:00', status: 'no_show', legacy_status: null, pax: 99 }),
      reservation({ id: '10000000-0000-4000-8000-000000000006', client_id: 'CB-OTHER', booking_time: '20:00:00', pax: 99 }),
    ],
  });
  const store = new SupabaseReservationStore(context, client);
  assert.deepEqual(await store.getAvailability({ date: '2026-08-15', requestedPax: 2, requestedTime: '20:00:00' }), {
    requestedPax: 2,
    availableTimes: ['20:00'],
    requestedTimeAvailable: true,
  });
});

test('invalid or disabled capacity slots are ignored', async () => {
  const client = new FixtureClient({
    booking_capacity_slots: [
      { client_id: context.clientId, slot_time: '18:00:00', capacity: 0, active: true, service: null, weekday: null, valid_from: null, valid_until: null },
      { client_id: context.clientId, slot_time: '19:00:00', capacity: 10, active: false, service: null, weekday: null, valid_from: null, valid_until: null },
    ],
  });
  const store = new SupabaseReservationStore(context, client);
  assert.deepEqual(await store.getAvailability({ date: '2026-08-15', requestedPax: 2 }), {
    requestedPax: 2,
    availableTimes: [],
    requestedTimeAvailable: false,
  });
});

test('listReservations maps SQL rows to internal models and uses provisional created_at,id order', async () => {
  const client = new FixtureClient({
    reservations: [
      reservation({ id: '20000000-0000-4000-8000-000000000002', legacy_reservation_id: null, public_reference: 'PUB-2', created_at: '2026-08-02T10:00:00Z' }),
      reservation({ id: '20000000-0000-4000-8000-000000000001', table_id: '30000000-0000-4000-8000-000000000001', resource_id: '40000000-0000-4000-8000-000000000001', created_at: '2026-08-01T10:00:00Z', legacy_status: 'CONFIRMED', legacy_source: 'BOT', legacy_locale: 'EN', arrived: true, feedback_sent: true, balinese_package: 'PACK-1' }),
      reservation({ client_id: 'CB-OTHER', legacy_reservation_id: 'RES-OTHER' }),
    ],
    restaurant_tables: [{ id: '30000000-0000-4000-8000-000000000001', client_id: context.clientId, label: 'M1' }],
    reservable_resources: [{ id: '40000000-0000-4000-8000-000000000001', client_id: context.clientId, label: 'B1' }],
  });
  const store = new SupabaseReservationStore(context, client);
  const rows = await store.listReservations();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: 'RES-FIXTURE-001', date: '15/08/2026', time: '20:00', name: 'Cliente Ejemplo',
    phone: '600000000', pax: 2, language: 'EN', specialRequest: 'Sin datos reales',
    status: 'CONFIRMED', origin: 'BOT', table: 'M1', arrived: true, feedbackSent: true,
    room: '', service: 'CENA', balinesePackage: 'PACK-1', resource: 'B1', sourceChannel: 'typebot',
  });
  assert.equal(rows[1].id, 'PUB-2');
});

test('getReservation searches legacy id, public reference and UUID without leaking rows', async () => {
  const uuid = '50000000-0000-4000-8000-000000000001';
  const client = new FixtureClient({ reservations: [reservation({ id: uuid })] });
  const store = new SupabaseReservationStore(context, client);
  assert.equal((await store.getReservation('RES-FIXTURE-001'))?.id, 'RES-FIXTURE-001');
  assert.equal((await store.getReservation('PUB-FIXTURE-001'))?.id, 'RES-FIXTURE-001');
  assert.equal((await store.getReservation(uuid))?.id, 'RES-FIXTURE-001');
  assert.equal(await store.getReservation(''), null);
  assert.equal(await store.getReservation('RES-FROM-ANOTHER-TENANT'), null);
});

test('orphaned table and resource references map to empty internal fields', async () => {
  const client = new FixtureClient({
    reservations: [reservation({
      table_id: '60000000-0000-4000-8000-000000000001',
      resource_id: '70000000-0000-4000-8000-000000000001',
    })],
  });
  const [mapped] = await new SupabaseReservationStore(context, client).listReservations();
  assert.equal(mapped.table, '');
  assert.equal(mapped.resource, '');
});

test('an inaccessible reservations table produces an explicit list error', async () => {
  const store = new SupabaseReservationStore(context, new SelectiveFailureClient({}, 'reservations'));
  await assert.rejects(() => store.listReservations(), /SUPABASE_RESERVATION_STORE_LIST_RESERVATIONS_FAILED/);
});

test('a failed availability query produces an explicit read error', async () => {
  const store = new SupabaseReservationStore(context, new SelectiveFailureClient({
    booking_capacity_slots: [],
  }, 'reservations'));
  await assert.rejects(
    () => store.getAvailability({ date: '2026-08-15', requestedPax: 2 }),
    /SUPABASE_RESERVATION_STORE_GET_AVAILABILITY_RESERVATIONS_FAILED/,
  );
});

test('the Supabase store exposes no mutating methods', () => {
  const store = new SupabaseReservationStore(context, new FixtureClient());
  for (const method of ['createReservation', 'createManualReservation', 'createWalkIn', 'cancelReservation', 'updateArrival', 'assignTable']) {
    assert.equal(method in store, false);
  }
});
