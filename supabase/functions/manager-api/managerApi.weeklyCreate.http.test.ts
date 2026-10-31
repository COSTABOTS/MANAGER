// Full manager-api Request/Response tests. All network calls are intercepted locally.
import { madridNow } from './internalWeeklyCreateGuard.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

type Store = 'supabase' | 'sheets';
type State = {
  tenant: string;
  requestedTenant: string;
  store: Store;
  flag: string | null;
  services: string;
  rules: Record<string, unknown>[];
  settingsFailure?: boolean;
  rulesFailure?: boolean;
  internalCapacityFailure?: boolean;
  writes: Array<{ tenant: string; service: string; date: string; time: string; store: Store }>;
  ruleReads: number;
  settingsReads: number;
};

const rules = Array.from({ length: 7 }, (_, weekday) =>
  (['DESAYUNO', 'ALMUERZO', 'CENA'] as const).map((service) => ({
    weekday, service,
    enabled: service === 'CENA' || (service === 'ALMUERZO' && weekday === 0),
    start_time: service === 'CENA' ? '19:00:00' : service === 'ALMUERZO' && weekday === 0 ? '11:00:00' : null,
    end_time: service === 'CENA' ? '23:00:00' : service === 'ALMUERZO' && weekday === 0 ? '18:00:00' : null,
  }))).flat();

const state: State = {
  tenant: 'TENANT_A', requestedTenant: 'TENANT_B', store: 'supabase', flag: 'true',
  services: 'ALMUERZO,CENA,BALINESA', rules, writes: [], ruleReads: 0, settingsReads: 0,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalServe = Object.getOwnPropertyDescriptor(Deno, 'serve');
const originalValues = new Map<string, string | undefined>();
for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'ENABLE_MANAGER_WEEKLY_CREATE_GUARD', 'GOOGLE_SERVICE_ACCOUNT_JSON']) {
  originalValues.set(key, Deno.env.get(key));
}

let handler: ((request: Request) => Promise<Response>) | undefined;
Object.defineProperty(Deno, 'serve', {
  configurable: true,
  value: (callback: (request: Request) => Promise<Response>) => {
    handler = callback;
    return { finished: Promise.resolve(), shutdown() {}, ref() {}, unref() {} };
  },
});

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === 'https://edge-test.invalid') {
    if (url.pathname === '/auth/v1/user') {
      return json({ id: 'TEST_USER', aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid' });
    }
    if (url.pathname.endsWith('/PROFILES')) return json({ client_id: state.tenant, role: 'ADMIN_CLIENTE', status: 'ACTIVE' });
    if (url.pathname.endsWith('/CLIENTES')) return json({ client_id: state.tenant, sheet_id: 'TEST_SHEET', reservation_store: state.store, status: 'ACTIVE' });
    if (url.pathname.endsWith('/SETTINGS')) {
      state.settingsReads++;
      return state.settingsFailure ? json({ code: 'TEST_READ_FAILURE', message: 'test read failure' }, 503)
        : json([...(state.flag === null ? [] : [{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: state.flag }]),
          { CLAVE: 'SERVICES_ENABLED', VALOR: state.services }]);
    }
    if (url.pathname.endsWith('/booking_service_hours')) {
      state.ruleReads++;
      assert(url.searchParams.get('client_id') === `eq.${state.tenant}`, 'rules must be scoped to authenticated tenant');
      return state.rulesFailure ? json({ code: 'TEST_READ_FAILURE', message: 'test read failure' }, 503) : json(state.rules);
    }
    if (url.pathname.endsWith('/booking_capacity_slots') && request.method === 'GET') {
      assert(url.searchParams.get('client_id') === `eq.${state.tenant}`, 'capacity must use authenticated tenant');
      return json([
        { service: null, slot_time: '18:00:00', capacity: 20, active: true },
        { service: 'CENA', slot_time: '19:00:00', capacity: 25, active: true },
      ]);
    }
    if (url.pathname.endsWith('/reservations') && request.method === 'POST') {
      const payload = await request.json() as Record<string, unknown>;
      if (state.internalCapacityFailure && (payload.source_channel === 'walk_in' || payload.source_channel === 'manager_manual')) {
        return json({ code: 'P0001', message: 'AVAILABILITY_EXHAUSTED' }, 409);
      }
      state.writes.push({ tenant: String(payload.client_id), service: String(payload.service),
        date: String(payload.booking_date), time: String(payload.booking_time), store: 'supabase' });
      return json({ id: 'TEST_RESERVATION' });
    }
  }
  if (url.href === 'https://oauth2.googleapis.com/token') return json({ access_token: 'TEST_GOOGLE_TOKEN' });
  if (url.hostname === 'sheets.googleapis.com' && url.pathname.includes(':append')) {
    const payload = await request.json() as { values: unknown[][] };
    const row = payload.values[0];
    state.writes.push({ tenant: state.tenant, service: String(row[16]), date: String(row[1]), time: String(row[2]), store: 'sheets' });
    return json({ updates: { updatedRows: 1 } });
  }
  throw new Error(`UNMOCKED_NETWORK: ${url.origin}${url.pathname}`);
};

async function request(action: 'reservation.create' | 'walkin.create', service: string, date: string, time: string) {
  assert(handler, 'manager-api handler was not registered');
  const input = action === 'reservation.create'
    ? { reservation: { nombre: 'Test', pax: 2, fecha: date, hora: time, servicio: service } }
    : { walkin: { pax: 2, fecha: date, hora: time, servicio: service } };
  const response = await handler(new Request('https://manager-api.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer TEST_TOKEN', Origin: 'https://manager.costabots.com' },
    body: JSON.stringify({ action, client_id: state.requestedTenant, ...input }),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function reset(store: Store = 'supabase') {
  Object.assign(state, { tenant: 'TENANT_A', requestedTenant: 'TENANT_B', store, flag: 'true',
    services: 'ALMUERZO,CENA,BALINESA', rules, settingsFailure: false, rulesFailure: false, internalCapacityFailure: false,
    writes: [], ruleReads: 0, settingsReads: 0 });
  Deno.env.set('ENABLE_MANAGER_WEEKLY_CREATE_GUARD', 'true');
}

Deno.test('manager-api full HTTP creation with mocked Supabase and Sheets', async () => {
  try {
    console.log = () => {};
    Deno.env.set('SUPABASE_URL', 'https://edge-test.invalid');
    Deno.env.set('SUPABASE_ANON_KEY', 'TEST_ANON');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'TEST_SERVICE_ROLE');
    // A disposable in-memory key permits exercising the Sheets append path without external calls.
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----`;
    Deno.env.set('GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify({ client_email: 'test@example.invalid', private_key: pem }));
    await import('./index.ts');

    assert(handler, 'manager-api handler was not registered');
    const capacityResponse = await handler(new Request('https://manager-api.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer TEST_TOKEN', Origin: 'https://manager.costabots.com' },
      body: JSON.stringify({ action: 'capacity.list', client_id: 'TENANT_B' }),
    }));
    const capacityBody = await capacityResponse.json() as Record<string, unknown>;
    assert(capacityResponse.status === 200 && capacityBody.client_id === 'TENANT_A'
      && JSON.stringify(capacityBody.shared) === JSON.stringify([{ hora: '18:00', limite: 20, activo: true }])
      && (capacityBody.services as Record<string, unknown[]>).CENA.length === 1 && state.writes.length === 0,
      'capacity.list adds shared rows without writing or exposing a forged tenant');

    for (const store of ['supabase', 'sheets'] as const) {
      reset(store);
      let result = await request('reservation.create', 'ALMUERZO', '2026-11-01', '11:00');
      assert(result.status === 200 && result.body.ok === true && state.writes.length === 1, `${store}: open service writes once`);
      assert(state.writes[0].tenant === 'TENANT_A', `${store}: forged tenant never receives write`);
      for (const [service, date, time, expected] of [
        ['ALMUERZO', '2026-10-29', '12:00', 'RESERVATION_OUTSIDE_WEEKLY_HOURS'],
        ['ALMUERZO', '2026-11-01', '18:00', 'RESERVATION_OUTSIDE_WEEKLY_HOURS'],
        ['DESAYUNO', '2026-11-01', '12:00', 'SERVICE_NOT_ENABLED'],
        ['', '2026-11-01', '20:00', 'SERVICE_NOT_ENABLED'],
        ['UNKNOWN_SERVICE', '2026-11-01', '20:00', 'SERVICE_NOT_ENABLED'],
      ]) {
        const writesBefore: number = state.writes.length;
        result = await request('reservation.create', service, date, time);
        assert(result.status === 409 && result.body.code === expected && Number(state.writes.length) === writesBefore,
          `${store}: ${expected} must reject without write`);
      }
      state.rules = rules.slice(0, 20);
      result = await request('reservation.create', 'ALMUERZO', '2026-11-01', '12:00');
      assert(result.status === 503 && result.body.code === 'WEEKLY_HOURS_CONFIG_INVALID' && state.writes.length === 1,
        `${store}: incomplete rules fail closed`);
      state.rules = rules;
      state.rulesFailure = true;
      result = await request('reservation.create', 'ALMUERZO', '2026-11-01', '12:00');
      assert(result.status === 503 && result.body.code === 'WEEKLY_HOURS_CONFIG_READ_FAILED' && state.writes.length === 1,
        `${store}: rule read failure fails closed`);
      state.rulesFailure = false;
      state.settingsFailure = true;
      result = await request('reservation.create', 'ALMUERZO', '2026-11-01', '12:00');
      assert(result.status === 503 && result.body.code === 'WEEKLY_HOURS_CONFIG_READ_FAILED' && state.writes.length === 1,
        `${store}: SETTINGS read failure fails closed`);
      state.settingsFailure = false;
      result = await request('reservation.create', 'BALINESA', '2026-11-01', '12:00');
      assert(result.status === 200 && Number(state.writes.length) === 2, `${store}: Balinesa remains independent`);
    }

    reset('supabase');
    const OriginalDate = Date;
    let walkInInstant = '2026-11-01T10:30:00Z';
    try {
      globalThis.Date = class extends OriginalDate {
        constructor(...args: unknown[]) {
          super(args.length ? args[0] as string | number : walkInInstant);
        }
        static override now() { return new OriginalDate(walkInInstant).getTime(); }
      } as DateConstructor;
      const result = await request('walkin.create', 'ALMUERZO', '2027-01-01', '20:00');
      assert(result.status === 200 && state.writes.length === 1, 'walk-in open now writes once');
      const clock = madridNow(new OriginalDate('2026-11-01T10:30:00Z'));
      assert(state.writes[0].date === clock.date && state.writes[0].time.startsWith('11:30'), 'walk-in uses server Madrid clock');
      const before = state.writes.length;
      const closed = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
      assert(closed.status === 409 && closed.body.code === 'WALKIN_OUTSIDE_WEEKLY_HOURS' && state.writes.length === before,
        'walk-in outside current service hours rejects without write');
      reset('sheets');
      const sheetsOpen = await request('walkin.create', 'ALMUERZO', '2027-01-01', '20:00');
      assert(sheetsOpen.status === 200 && state.writes.length === 1 && state.writes[0].store === 'sheets' &&
        state.writes[0].date === clock.date && state.writes[0].time === '11:30',
      'Sheets walk-in uses server Madrid clock and appends once');
      const sheetsClosed = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
      assert(sheetsClosed.status === 409 && state.writes.length === 1,
        'Sheets closed walk-in never appends');

      for (const store of ['supabase', 'sheets'] as const) {
        reset(store);
        state.rules = rules.map((rule) => rule.service === 'CENA' ? { ...rule, start_time: '18:00:00' } : rule);
        walkInInstant = '2026-10-29T16:29:59Z'; // 17:29:59 CET, before the margin.
        const early = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
        assert(early.status === 409 && Number(state.writes.length) === 0, `${store}: too-early walk-in never writes`);
        walkInInstant = '2026-10-29T16:30:00Z';
        const atEarlyBoundary = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
        assert(atEarlyBoundary.status === 200 && state.writes.length === 1, `${store}: 17:30 admits dinner`);
        walkInInstant = '2026-10-29T16:50:00Z'; // 17:50 CET for an 18:00 dinner.
        const beforeDinner = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
        assert(beforeDinner.status === 200 && state.writes.length === 2 && state.writes[1].service === 'CENA'
          && state.writes[1].time.startsWith('17:50'), `${store}: early dinner keeps actual arrival`);
        walkInInstant = '2026-10-29T17:00:00Z';
        const duringDinner = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
        assert(duringDinner.status === 200 && state.writes.length === 3
          && state.writes[2].service === 'CENA' && state.writes[2].date === '2026-10-29'
          && state.writes[2].time.startsWith('18:00'),
          `${store}: service start is inclusive and keeps actual arrival time`);
        walkInInstant = '2026-10-29T22:00:00Z';
        const atClose = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
        walkInInstant = '2026-10-29T22:29:59Z';
        const beforeLateCutoff = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
        walkInInstant = '2026-10-29T22:30:00Z';
        const lateBoundary = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
        walkInInstant = '2026-10-29T22:30:01Z';
        const lateCutoff = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
        assert(atClose.status === 200 && beforeLateCutoff.status === 200 && lateBoundary.status === 200
          && lateCutoff.status === 409,
          `${store}: post-close margin includes exactly 23:30`);
        if (store === 'supabase') {
          state.internalCapacityFailure = true;
          walkInInstant = '2026-10-29T22:00:00Z';
          const full = await request('walkin.create', 'CENA', '2027-01-01', '20:00');
          assert(full.status === 409 && full.body.code === 'AVAILABILITY_EXHAUSTED'
            && Number(state.writes.length) === 6, 'Supabase capacity rejection is safe and adds no reservation');
        }
      }
    } finally {
      globalThis.Date = OriginalDate;
    }

    reset();
    state.internalCapacityFailure = true;
    const manualFull = await request('reservation.create', 'ALMUERZO', '2026-11-01', '11:00');
    assert(manualFull.status === 409 && manualFull.body.code === 'AVAILABILITY_EXHAUSTED'
      && state.writes.length === 0, 'manual capacity rejection returns a controlled error without a write');

    reset();
    state.tenant = 'TENANT_B';
    state.requestedTenant = 'TENANT_A';
    const secondTenant = await request('reservation.create', 'ALMUERZO', '2026-11-01', '11:00');
    assert(secondTenant.status === 200 && state.writes.length === 1 && state.writes[0].tenant === 'TENANT_B',
      'second authenticated tenant writes only its own reservation');

    reset();
    state.flag = 'false';
    state.settingsFailure = true;
    const unreadableLegacy = await request('reservation.create', 'CENA', '2026-11-01', '20:00');
    assert(unreadableLegacy.status === 503 && Number(state.writes.length) === 0,
      'global guard on cannot distinguish legacy from weekly after SETTINGS failure, so rejects safely');
    state.settingsFailure = false;
    const readableLegacy = await request('reservation.create', '', '2026-11-01', '03:00');
    assert(readableLegacy.status === 200 && state.writes.length === 1 && state.ruleReads === 0,
      'readable false tenant flag preserves legacy fallback and avoids weekly rule reads');
    state.flag = null;
    const absentFlagLegacy = await request('reservation.create', '', '2026-11-01', '03:00');
    assert(absentFlagLegacy.status === 200 && Number(state.writes.length) === 2 && state.ruleReads === 0,
      'absent tenant flag preserves legacy fallback and avoids weekly rule reads');

    reset();
    Deno.env.set('ENABLE_MANAGER_WEEKLY_CREATE_GUARD', 'false');
    state.settingsFailure = true;
    const legacy = await request('reservation.create', '', '2026-10-29', '03:00');
    assert(legacy.status === 200 && state.settingsReads === 0 && state.ruleReads === 0 && Number(state.writes.length) === 1,
      'disabled global guard preserves legacy path without extra reads');
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    if (originalServe) Object.defineProperty(Deno, 'serve', originalServe);
    for (const [key, value] of originalValues) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
});
