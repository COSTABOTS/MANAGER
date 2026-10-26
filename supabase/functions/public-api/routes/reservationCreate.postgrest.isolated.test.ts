import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SupabaseReservationStore, type SupabaseReadClient } from '../../_shared/reservation-store/supabaseReservationStore.ts';
import type { DbClient } from '../lib/clients.ts';
import { handleReservationCreate } from './reservationCreate.ts';

const madridParts = Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(({ type, value }) => [type, value]),
);
const madridToday = new Date(Date.UTC(Number(madridParts.year), Number(madridParts.month) - 1, Number(madridParts.day)));
const futureSunday = new Date(madridToday);
futureSunday.setUTCDate(futureSunday.getUTCDate() + 14);
futureSunday.setUTCDate(futureSunday.getUTCDate() + ((7 - futureSunday.getUTCDay()) % 7));
const pastSunday = new Date(madridToday);
pastSunday.setUTCDate(pastSunday.getUTCDate() - 14);
pastSunday.setUTCDate(pastSunday.getUTCDate() - pastSunday.getUTCDay());
const apiNow = new Date(pastSunday.getTime() - 24 * 60 * 60 * 1000);
const futureDate = futureSunday.toISOString().slice(0, 10);
const pastDate = pastSunday.toISOString().slice(0, 10);

const cases = {
  time: { date: pastDate, time: '16:00', service: 'ALMUERZO', pax: 1, code: 'RESERVATION_TIME_PASSED', status: 409 },
  closed: { date: futureDate, time: '19:00', service: 'ALMUERZO', pax: 1, code: 'RESERVATION_OUTSIDE_WEEKLY_HOURS', status: 409 },
  service: { date: futureDate, time: '20:00', service: 'CENA', pax: 1, code: 'SERVICE_NOT_ENABLED', status: 409 },
  capacity: { date: futureDate, time: '17:00', service: 'ALMUERZO', pax: 2, code: 'AVAILABILITY_EXHAUSTED', status: 409 },
  invalid: { date: futureDate, time: '16:00', service: 'ALMUERZO', pax: 1, code: 'WEEKLY_HOURS_CONFIG_INVALID', status: 500 },
  read: { date: futureDate, time: '16:00', service: 'ALMUERZO', pax: 1, code: 'WEEKLY_HOURS_CONFIG_READ_FAILED', status: 500 },
  unexpected: { date: futureDate, time: '16:00', service: 'ALMUERZO', pax: 1, code: 'RESERVATION_CREATE_FAILED', status: 500 },
} as const;

type CaseName = keyof typeof cases;

Deno.test('isolated PostgreSQL -> PostgREST -> Supabase store -> public API preserves safe rejection contracts', async () => {
  const caseName = Deno.env.get('COSTABOTS_RPC_CASE') as CaseName;
  const endpoint = Deno.env.get('COSTABOTS_POSTGREST_URL') ?? '';
  if (!Object.hasOwn(cases, caseName) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) {
    throw new Error('An explicit case and loopback-only PostgREST URL are required');
  }
  const scenario = cases[caseName];
  const apiServices = caseName === 'service' ? 'ALMUERZO,CENA' : 'ALMUERZO';
  const apiLunchEnd = caseName === 'closed' ? '23:00' : '18:00';
  const rules = Array.from({ length: 7 }, (_, weekday) =>
    (['DESAYUNO', 'ALMUERZO', 'CENA'] as const).map((service) => {
      const lunch = weekday === 0 && service === 'ALMUERZO';
      const dinner = weekday === 0 && service === 'CENA' && caseName === 'service';
      return {
        weekday, service, enabled: lunch || dinner,
        start_time: lunch ? '11:00' : dinner ? '19:00' : null,
        end_time: lunch ? apiLunchEnd : dinner ? '23:00' : null,
      };
    })).flat();
  const client = createClient('https://isolated.test', 'local-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split('/').at(-1);
        let rows: Record<string, unknown>[];
        if (table === 'CLIENTES') {
          rows = [{ client_id: 'TEST-RPC-WEEKLY', public_token: 'local-public-token', status: 'ACTIVE',
            reservation_store: 'supabase', sheet_id: '' }];
        } else if (table === 'SETTINGS') {
          rows = [
            { CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'true' },
            { CLAVE: 'SERVICES_ENABLED', VALOR: apiServices },
          ];
          const key = url.searchParams.get('CLAVE');
          if (key?.startsWith('eq.')) rows = rows.filter((row) => row.CLAVE === key.slice(3));
          if (key?.startsWith('in.')) rows = rows.filter((row) => key.includes(String(row.CLAVE)));
        } else if (table === 'booking_service_hours') {
          rows = rules;
        } else {
          throw new Error(`Unexpected validation table: ${table}`);
        }
        const accept = new Headers(init?.headers).get('Accept') ?? '';
        return new Response(JSON.stringify(accept.includes('application/vnd.pgrst.object+json') ? rows[0] ?? null : rows), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  }) as DbClient;

  let rpcCalls = 0;
  let rawError: Record<string, unknown> | null = null;
  const rpcClient: SupabaseReadClient = {
    from: () => { throw new Error('Unexpected store table read'); },
    rpc: async (name, params) => {
      rpcCalls++;
      const result = await fetch(`${endpoint}/rpc/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
      });
      const payload = await result.json() as Record<string, unknown>;
      if (result.ok) return { data: payload, error: null };
      rawError = payload;
      return { data: null, error: { code: String(payload.code ?? ''), message: String(payload.message ?? '') } };
    },
  };
  const request = new Request('https://isolated.test/public-api/reservation/create', {
    method: 'POST',
    body: JSON.stringify({
      client_id: 'TEST-RPC-WEEKLY', public_token: 'local-public-token', nombre: 'ISOLATED TEST',
      telefono: '000000000', fecha: scenario.date.split('-').reverse().join('/'),
      hora: scenario.time, personas: scenario.pax, servicio: scenario.service,
    }),
  });
  const response = await handleReservationCreate(request, client, {
    now: () => apiNow,
    weeklyCreateGuardEnabled: true,
    createStore: (context) => new SupabaseReservationStore(context, rpcClient),
  });
  if (!response) throw new Error('Expected a public API response');
  const body = await response.json() as Record<string, unknown>;
  assertEquals(rpcCalls, 1);
  assertEquals(rawError?.code, caseName === 'unexpected' ? '42P01' : 'P0001');
  if (caseName !== 'unexpected') assertEquals(rawError?.message, scenario.code);
  assertEquals([response.status, body.ok, body.code, body.error, body.message],
    [scenario.status, false, scenario.code, scenario.code, scenario.code]);
  if (caseName === 'unexpected') {
    assertEquals(JSON.stringify(body).includes(String(rawError?.message)), false);
  }
  assertEquals('reservation_created' in body || 'id_reserva' in body, false);
});
