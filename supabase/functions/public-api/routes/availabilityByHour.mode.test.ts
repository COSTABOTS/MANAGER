import type { DbClient } from '../lib/clients.ts';
import { handleAvailabilityByHour } from './availabilityByHour.ts';

type Row = Record<string, unknown>;

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private single = false;
  constructor(private readonly rows: Row[], private readonly failure = false) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  order() { return this; }
  maybeSingle() { this.single = true; return this; }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const matches = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    const result = this.failure ? { data: null, error: { message: 'synthetic read failure' } }
      : { data: this.single ? matches[0] ?? null : matches, error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

class Client {
  readonly reads: string[] = [];
  constructor(private readonly tables: Record<string, Row[]>, private readonly failedTable?: string) {}
  from(table: string) {
    this.reads.push(table);
    return new Query(this.tables[table] ?? [], table === this.failedTable);
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const clientId = 'CB-LOCAL-TEST';
const token = 'LOCAL-TOKEN';
const date = '2099-08-16';

function tables(weekly: boolean): Record<string, Row[]> {
  return {
    CLIENTES: [{ client_id: clientId, public_token: token, status: 'ACTIVE', reservation_store: 'supabase' }],
    SETTINGS: [{ CLIENTE_ID: clientId, CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: weekly ? 'true' : 'false' },
      { CLIENTE_ID: clientId, CLAVE: 'SERVICES_ENABLED', VALOR: 'ALMUERZO,CENA' }],
    booking_service_hours: Array.from({ length: 7 }, (_, weekday) => ['DESAYUNO', 'ALMUERZO', 'CENA'].map((service) => ({
      client_id: clientId, weekday, service, enabled: true, start_time: '12:00:00', end_time: '16:00:00',
    }))).flat(),
    booking_capacity_slots: [{ client_id: clientId, slot_time: '13:00:00', capacity: 8, active: true,
      service: 'CENA', weekday: null, valid_from: null, valid_until: null }],
    reservations: [], booking_day_controls: [], booking_blocks: [],
  };
}

async function call(client: Client) {
  const request = new Request('https://local.test/public-api/availability/by-hour', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, public_token: token, fecha: date, pax: 2, servicio: 'CENA' }),
  });
  const response = await handleAvailabilityByHour(request, client as unknown as DbClient);
  if (!response) throw new Error('availability handler returned no response');
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

Deno.test('HTTP availability reports WEEKLY only after applying verified rules', async () => {
  const client = new Client(tables(true));
  const { status, body } = await call(client);
  assert(status === 200 && body.ok === true && body.availability_mode === 'WEEKLY', 'weekly response mode');
  assert(JSON.stringify(body.horas_disponibles) === '["13:00"]', 'existing available hours');
  assert(typeof body.horas_disponibles_texto === 'string' && 'DISPONIBLE' in body && 'resultado' in body,
    'existing response fields remain present');
  assert(client.reads.includes('booking_service_hours'), 'weekly rules were read');
});

Deno.test('HTTP availability reports LEGACY and does not read weekly rules when disabled', async () => {
  const client = new Client(tables(false));
  const { status, body } = await call(client);
  assert(status === 200 && body.availability_mode === 'LEGACY', 'legacy response mode');
  assert(JSON.stringify(body.horas_disponibles) === '["13:00"]', 'legacy capacity result unchanged');
  assert(!client.reads.includes('booking_service_hours'), 'legacy does not read weekly rules');
});

Deno.test('weekly configuration read error never returns a successful LEGACY fallback', async () => {
  const { status, body } = await call(new Client(tables(true), 'booking_service_hours'));
  assert(status >= 400 && body.ok !== true && !('availability_mode' in body), 'read error is an error response');
});

Deno.test('incomplete weekly rules cannot produce a mode or hours', async () => {
  const data = tables(true);
  data.booking_service_hours.pop();
  const { status, body } = await call(new Client(data));
  assert(status >= 400 && body.ok !== true && !('availability_mode' in body), 'incomplete weekly configuration fails');
});

Deno.test('Fully Booked still blocks hours while reporting the verified weekly mode', async () => {
  const data = tables(true);
  data.booking_day_controls = [{ client_id: clientId, booking_date: date, service: 'CENA', status: 'open', fully_booked: true }];
  const { status, body } = await call(new Client(data));
  assert(status === 200 && body.availability_mode === 'WEEKLY', 'verified mode remains weekly');
  assert(JSON.stringify(body.horas_disponibles) === '[]', 'Fully Booked blocks availability');
});
