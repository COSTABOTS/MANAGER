import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { DbClient } from '../lib/clients.ts';
import { handleAvailabilityByDay } from './availabilityByDay.ts';

type Row = Record<string, unknown>;
class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private single = false;
  constructor(private readonly rows: Row[], private readonly failure = false) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  maybeSingle() { this.single = true; return this; }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const found = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    const value = this.failure ? { data: null, error: { message: 'synthetic read error' } }
      : { data: this.single ? found[0] ?? null : found, error: null };
    return Promise.resolve(value).then(onfulfilled, onrejected);
  }
}
class Client {
  readonly reads: string[] = [];
  constructor(private readonly tables: Record<string, Row[]>, private readonly failSettings = false) {}
  from(table: string) { this.reads.push(table); return new Query(this.tables[table] ?? [], table === 'SETTINGS' && this.failSettings); }
}
const clientId = 'CB-LOCAL-DAY';
const token = 'LOCAL-TOKEN';
function rules() {
  return Array.from({ length: 7 }, (_, weekday) => ['DESAYUNO', 'ALMUERZO', 'CENA'].map((service) => ({
    client_id: clientId, weekday, service, enabled: weekday === 0 && service === 'ALMUERZO',
    start_time: weekday === 0 && service === 'ALMUERZO' ? '11:00:00' : null,
    end_time: weekday === 0 && service === 'ALMUERZO' ? '18:00:00' : null,
  }))).flat();
}
function tables(settings: Row[]): Record<string, Row[]> {
  return { CLIENTES: [{ client_id: clientId, public_token: token, status: 'ACTIVE', reservation_store: 'supabase' }],
    SETTINGS: settings.map((row) => ({ CLIENTE_ID: clientId, ...row })), booking_service_hours: rules(), booking_day_controls: [] };
}
async function call(client: Client, date = '2026-08-16') {
  const request = new Request('https://local.test/availability/by-day', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, public_token: token, fecha: date, servicio: 'ALMUERZO' }) });
  const response = await handleAvailabilityByDay(request, client as unknown as DbClient);
  if (!response) throw new Error('Handler returned no response');
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
Deno.test('legacy day availability makes only the pre-existing SETTINGS request', async () => {
  for (const settings of [[], [{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'false' }]]) {
    const client = new Client(tables(settings));
    const result = await call(client);
    assertEquals([result.status, result.body.available, result.body.reason], [200, true, 'open']);
    assertEquals(client.reads.filter((table) => table === 'SETTINGS').length, 1);
    assertEquals(client.reads.includes('booking_service_hours'), false);
  }
});
Deno.test('weekly day rules use the same SETTINGS result and close Monday', async () => {
  const settings = [{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'true' }, { CLAVE: 'SERVICES_ENABLED', VALOR: 'ALMUERZO' }];
  const client = new Client(tables(settings));
  const sunday = await call(client);
  const monday = await call(client, '2026-08-17');
  assertEquals([sunday.body.available, monday.body.available, monday.body.reason], [true, false, 'outside_weekly_hours']);
  assertEquals(client.reads.filter((table) => table === 'SETTINGS').length, 2);
});
Deno.test('failed SETTINGS read never declares a day open', async () => {
  const client = new Client(tables([]), true);
  const result = await call(client);
  assertEquals(result.status, 500);
  assertEquals(result.body.ok, false);
  assertEquals(client.reads.includes('booking_service_hours'), false);
});
Deno.test('BOOKINGS_ENABLED keeps its legacy priority when query includes weekly keys', async () => {
  const client = new Client(tables([{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'false' }, { CLAVE: 'BOOKINGS_ENABLED', VALOR: 'false' }]));
  const result = await call(client);
  assertEquals([result.status, result.body.available, result.body.reason], [200, false, 'bookings_disabled']);
});
