import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleReservationCreate, isWeeklyCreateGuardEnabled } from './reservationCreate.ts';
import type { BookingServiceHoursRow } from '../../_shared/booking-hours/weeklyHoursAdapter.ts';
import type { DbClient } from '../lib/clients.ts';

type Tenant = {
  id: string;
  store: 'supabase' | 'sheets';
  weeklyFlag?: string;
  services?: string;
  bookings?: string;
  rules?: BookingServiceHoursRow[];
  failSettings?: boolean;
  failRules?: boolean;
  throwRules?: boolean;
};

function weeklyRules(open: Partial<Record<'DESAYUNO' | 'ALMUERZO' | 'CENA', [string, string]>> = { ALMUERZO: ['11:00', '18:00'] }) {
  return Array.from({ length: 7 }, (_, weekday) =>
    (['DESAYUNO', 'ALMUERZO', 'CENA'] as const).map((service) => {
      const hours = weekday === 0 ? open[service] : undefined;
      return {
        weekday, service, enabled: Boolean(hours),
        start_time: hours?.[0] ?? null, end_time: hours?.[1] ?? null,
      };
    })).flat();
}

function harness(tenants: Tenant[], weeklyCreateGuardEnabled = true) {
  const reads: Array<{ table: string; tenant: string }> = [];
  const writes: Array<{ tenant: string; service: string }> = [];
  const byId = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const db = createClient('https://isolated.test', 'local-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split('/').at(-1) ?? '';
        const tenantId = (url.searchParams.get('client_id') ?? url.searchParams.get('CLIENTE_ID') ?? '').replace(/^eq\./, '');
        const tenant = byId.get(tenantId);
        reads.push({ table, tenant: tenantId });
        if (!tenant) throw new Error(`Unexpected tenant: ${tenantId}`);
        if (table === 'booking_service_hours' && tenant.throwRules) throw new Error('isolated transport failure');
        if ((table === 'SETTINGS' && tenant.failSettings) || (table === 'booking_service_hours' && tenant.failRules)) {
          return new Response(JSON.stringify({ code: 'MOCK_READ_FAILED', message: 'isolated read error' }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
          });
        }
        let rows: Record<string, unknown>[] = [];
        if (table === 'CLIENTES') {
          rows = [{ client_id: tenant.id, public_token: 'local-public-token', status: 'ACTIVE',
            reservation_store: tenant.store, sheet_id: 'local-sheet-id' }];
        } else if (table === 'SETTINGS') {
          rows = [
            ...(tenant.weeklyFlag === undefined ? [] : [{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: tenant.weeklyFlag }]),
            ...(tenant.services === undefined ? [] : [{ CLAVE: 'SERVICES_ENABLED', VALOR: tenant.services }]),
            ...(tenant.bookings === undefined ? [] : [{ CLAVE: 'BOOKINGS_ENABLED', VALOR: tenant.bookings }]),
          ];
          const key = url.searchParams.get('CLAVE');
          if (key?.startsWith('eq.')) rows = rows.filter((row) => row.CLAVE === key.slice(3));
          if (key?.startsWith('in.')) rows = rows.filter((row) => key.includes(String(row.CLAVE)));
        } else if (table === 'booking_service_hours') {
          rows = (tenant.rules ?? []) as Record<string, unknown>[];
        } else {
          throw new Error(`Unexpected table: ${table}`);
        }
        const accept = new Headers(init?.headers).get('Accept') ?? '';
        return new Response(JSON.stringify(accept.includes('application/vnd.pgrst.object+json') ? rows[0] ?? null : rows), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  }) as DbClient;
  async function submit(id: string, service = 'ALMUERZO', time = '11:00', now = new Date('2026-10-24T10:00:00Z')) {
    const request = new Request('https://isolated.test/public-api/reservation/create', {
      method: 'POST',
      body: JSON.stringify({ client_id: id, public_token: 'local-public-token', nombre: 'LOCAL TEST',
        telefono: '000000000', fecha: '25/10/2026', hora: time, personas: 2, servicio: service }),
    });
    const response = await handleReservationCreate(request, db, {
      now: () => now,
      weeklyCreateGuardEnabled,
      createStore: (context) => ({
        createReservation: async (command) => {
          writes.push({ tenant: context.clientId, service: command.service });
          return { reservation: command };
        },
      }),
    });
    if (!response) throw new Error('Expected a public API response');
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  return { reads, writes, submit };
}

Deno.test('weekly create guard is disabled by default and only an explicit true enables it', () => {
  for (const value of [undefined, '', 'false', '0', '1', 'yes', 'enabled']) {
    assertEquals(isWeeklyCreateGuardEnabled(value), false);
  }
  assertEquals(isWeeklyCreateGuardEnabled('true'), true);
  assertEquals(isWeeklyCreateGuardEnabled(' TRUE '), true);
});

Deno.test('disabled weekly create guard preserves both stores without new SETTINGS reads', async () => {
  const test = harness([
    { id: 'SUPABASE', store: 'supabase', weeklyFlag: 'true', services: 'ALMUERZO', rules: weeklyRules({}) },
    { id: 'SHEETS', store: 'sheets', weeklyFlag: 'true', services: 'ALMUERZO', rules: weeklyRules({}) },
  ], false);
  for (const id of ['SUPABASE', 'SHEETS']) {
    assertEquals((await test.submit(id, 'ALMUERZO', '11:00')).status, 201);
  }
  assertEquals(test.writes.map((row) => row.tenant), ['SUPABASE', 'SHEETS']);
  assertEquals(test.reads.filter((row) => row.table === 'SETTINGS'), [{ table: 'SETTINGS', tenant: 'SUPABASE' }]);
  assertEquals(test.reads.filter((row) => row.table === 'booking_service_hours'), []);
});

Deno.test('disabled weekly create guard keeps exact 30-minute check before either store', async () => {
  for (const store of ['supabase', 'sheets'] as const) {
    const test = harness([{ id: store, store, weeklyFlag: 'true', rules: weeklyRules({}) }], false);
    const tooLate = await test.submit(store, 'ALMUERZO', '11:00', new Date('2026-10-25T09:30:00.001Z'));
    assertEquals([tooLate.status, tooLate.body.code], [409, 'RESERVATION_TIME_PASSED']);
    assertEquals(test.writes.length, 0);
    assertEquals((await test.submit(store, 'ALMUERZO', '11:00', new Date('2026-10-25T09:30:00Z'))).status, 201);
    assertEquals(test.writes.length, 1);
    assertEquals(test.reads.filter((row) => row.table === 'booking_service_hours'), []);
  }
});

Deno.test('full create handler keeps legacy Supabase and Sheets flows without reading weekly rules', async () => {
  const test = harness([
    { id: 'LEGACY-A', store: 'supabase' },
    { id: 'LEGACY-B', store: 'sheets', weeklyFlag: 'false' },
  ]);
  for (const id of ['LEGACY-A', 'LEGACY-B']) {
    const result = await test.submit(id, 'ALMUERZO', '22:00');
    assertEquals(result.status, 201);
  }
  assertEquals(test.writes.map((row) => row.tenant), ['LEGACY-A', 'LEGACY-B']);
  assertEquals(test.reads.filter((row) => row.table === 'booking_service_hours'), []);
});

Deno.test('full create handler enforces Sunday opening, inclusive start and exclusive end for both stores', async () => {
  for (const store of ['supabase', 'sheets'] as const) {
    const test = harness([{ id: store, store, weeklyFlag: 'true', services: 'ALMUERZO', rules: weeklyRules() }]);
    assertEquals((await test.submit(store, 'ALMUERZO', '11:00')).status, 201);
    for (const time of ['10:59', '18:00', '18:01']) {
      const result = await test.submit(store, 'ALMUERZO', time);
      assertEquals([result.status, result.body.code], [409, 'RESERVATION_OUTSIDE_WEEKLY_HOURS']);
    }
    assertEquals(test.writes.length, 1);
  }
});

Deno.test('full create handler rejects closed and unknown services without writing', async () => {
  const test = harness([{ id: 'CLOSED', store: 'supabase', weeklyFlag: 'true', services: 'ALMUERZO,CENA', rules: weeklyRules() }]);
  assertEquals((await test.submit('CLOSED', 'CENA', '20:00')).body.code, 'RESERVATION_OUTSIDE_WEEKLY_HOURS');
  assertEquals((await test.submit('CLOSED', 'SNACK', '12:00')).body.code, 'SERVICE_NOT_ENABLED');
  assertEquals(test.writes.length, 0);
});

Deno.test('full create handler defaults missing or empty SERVICES_ENABLED to CENA only in weekly mode', async () => {
  for (const services of [undefined, '']) {
    const test = harness([{ id: 'DEFAULT', store: 'supabase', weeklyFlag: 'true', services,
      rules: weeklyRules({ ALMUERZO: ['11:00', '18:00'], CENA: ['19:00', '23:00'] }) }]);
    assertEquals((await test.submit('DEFAULT', 'ALMUERZO', '12:00')).body.code, 'SERVICE_NOT_ENABLED');
    assertEquals((await test.submit('DEFAULT', 'CENA', '19:00')).status, 201);
    assertEquals(test.writes.length, 1);
  }
});

Deno.test('full create handler blocks explicitly disabled bookings only in weekly mode', async () => {
  const test = harness([{ id: 'DISABLED', store: 'sheets', weeklyFlag: 'true', services: 'ALMUERZO', bookings: 'false', rules: weeklyRules() }]);
  const result = await test.submit('DISABLED');
  assertEquals([result.status, result.body.code], [409, 'BOOKINGS_DISABLED']);
  assertEquals(test.writes.length, 0);
  const legacy = harness([{ id: 'LEGACY', store: 'sheets', weeklyFlag: 'false', bookings: 'false' }]);
  assertEquals((await legacy.submit('LEGACY')).status, 201);
});

Deno.test('full create handler fails closed on incomplete rules or read errors', async () => {
  for (const tenant of [
    { id: 'INCOMPLETE', store: 'supabase' as const, weeklyFlag: 'true', rules: weeklyRules().slice(0, 20) },
    { id: 'READ-FAIL', store: 'sheets' as const, weeklyFlag: 'true', failRules: true },
    { id: 'READ-THROWS', store: 'sheets' as const, weeklyFlag: 'true', throwRules: true },
    { id: 'SETTINGS-FAIL', store: 'supabase' as const, failSettings: true },
  ]) {
    const test = harness([tenant]);
    const result = await test.submit(tenant.id);
    assertEquals(result.status, 500);
    assertEquals(result.body.code, tenant.id === 'INCOMPLETE' ? 'WEEKLY_HOURS_CONFIG_INVALID' : 'WEEKLY_HOURS_CONFIG_READ_FAILED');
    assertEquals(test.writes.length, 0);
  }
});

Deno.test('full create handler keeps tenants isolated and retains exact 30-minute validation before writes', async () => {
  const test = harness([
    { id: 'OPEN', store: 'supabase', weeklyFlag: 'true', services: 'ALMUERZO', rules: weeklyRules() },
    { id: 'CLOSED', store: 'sheets', weeklyFlag: 'true', services: 'ALMUERZO', rules: weeklyRules({}) },
  ]);
  const tooLate = await test.submit('OPEN', 'ALMUERZO', '11:00', new Date('2026-10-25T09:30:00.001Z'));
  assertEquals([tooLate.status, tooLate.body.code], [409, 'RESERVATION_TIME_PASSED']);
  assertEquals(test.writes.length, 0);
  assertEquals((await test.submit('OPEN', 'ALMUERZO', '11:00', new Date('2026-10-25T09:30:00Z'))).status, 201);
  assertEquals((await test.submit('CLOSED')).body.code, 'RESERVATION_OUTSIDE_WEEKLY_HOURS');
  assertEquals(test.writes, [{ tenant: 'OPEN', service: 'ALMUERZO' }]);
  assertEquals(test.reads.filter((row) => row.table === 'booking_service_hours').map((row) => row.tenant),
    ['OPEN', 'OPEN', 'CLOSED']);
});
