import { guardInternalWeeklyCreate, madridNow } from './internalWeeklyCreateGuard.ts';
import type { WeeklyHoursReader } from '../_shared/booking-hours/weeklyHoursAdapter.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const rules = Array.from({ length: 7 }, (_, weekday) =>
  (['DESAYUNO', 'ALMUERZO', 'CENA'] as const).map((service) => ({
    weekday, service, enabled: service === 'CENA' || (service === 'ALMUERZO' && weekday === 0),
    start_time: service === 'CENA' ? '19:00:00' : service === 'ALMUERZO' && weekday === 0 ? '11:00:00' : null,
    end_time: service === 'CENA' ? '23:00:00' : service === 'ALMUERZO' && weekday === 0 ? '18:00:00' : null,
  }))).flat();

function reader(flag: string | undefined, services = 'ALMUERZO,CENA,BALINESA',
  options: { badRules?: boolean; readError?: boolean; rows?: typeof rules } = {}) {
  const reads: string[] = [];
  const access: WeeklyHoursReader = {
    async readSettings() {
      reads.push('SETTINGS');
      return options.readError ? { data: null, error: { message: 'unavailable' } }
        : { data: [...(flag === undefined ? [] : [{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: flag }]),
          { CLAVE: 'SERVICES_ENABLED', VALOR: services }], error: null };
    },
    async readRules() {
      reads.push('booking_service_hours');
      return { data: options.badRules ? rules.slice(0, 20) : options.rows ?? rules, error: null };
    },
  };
  return { access, reads };
}

async function directRequest(action: 'reservation.create' | 'walkin.create', service: string, date: string, time: string,
  access: WeeklyHoursReader, store: 'supabase' | 'sheets', now = new Date('2026-11-01T11:00:00Z')) {
  const request = new Request('https://manager-api.invalid/', { method: 'POST',
    body: JSON.stringify({ action, client_id: 'FORGED_OTHER_TENANT', [action === 'walkin.create' ? 'walkin' : 'reservation']:
      { servicio: service, fecha: date, hora: time } }) });
  const body = await request.json() as Record<string, Record<string, string> | string>;
  const input = body[action === 'walkin.create' ? 'walkin' : 'reservation'] as Record<string, string>;
  const guard = await guardInternalWeeklyCreate(action,
    { service: input.servicio, date: input.fecha, time: input.hora }, access, now, true);
  let writes = 0;
  if (guard.mode !== 'error') writes += 1; // Simulated persistence after the shared guard.
  return { status: guard.mode === 'error' ? guard.status : 200, code: guard.mode === 'error' ? guard.code : 'OK',
    writes, store, effective: guard.mode === 'weekly' ? { date: guard.date, time: guard.time, service: guard.service } : null };
}

Deno.test('direct-request payloads validate selected date, service and exclusive end before simulated stores', async () => {
  for (const store of ['supabase', 'sheets'] as const) {
    const open = await directRequest('reservation.create', 'ALMUERZO', '2026-11-01', '11:00', reader('true').access, store);
    const closed = await directRequest('reservation.create', 'ALMUERZO', '2026-10-29', '12:00', reader('true').access, store);
    const end = await directRequest('reservation.create', 'ALMUERZO', '2026-11-01', '18:00', reader('true').access, store);
    const missing = await directRequest('reservation.create', '', '2026-11-01', '12:00', reader('true').access, store);
    assert(open.status === 200 && open.writes === 1, `${store}: Sunday start allowed`);
    assert(closed.status === 409 && closed.writes === 0 && closed.code === 'RESERVATION_OUTSIDE_WEEKLY_HOURS', `${store}: closed Thursday`);
    assert(end.status === 409 && end.writes === 0, `${store}: end exclusive`);
    assert(missing.status === 409 && missing.writes === 0 && missing.code === 'SERVICE_NOT_ENABLED', `${store}: no CENA fallback`);
  }
});

Deno.test('direct-request walk-in payload ignores forged browser date/time and uses the Madrid server instant', async () => {
  const now = new Date('2026-11-01T10:30:00Z'); // 11:30 CET
  const open = await directRequest('walkin.create', 'ALMUERZO', '2027-01-01', '20:00', reader('true').access, 'supabase', now);
  assert(open.status === 200 && open.effective?.date === '2026-11-01' && open.effective.time === '11:30', 'server clock wins');
  const closed = await directRequest('walkin.create', 'ALMUERZO', '2026-11-01', '11:30', reader('true').access,
    'sheets', new Date('2026-10-29T11:30:00Z'));
  assert(closed.status === 409 && closed.writes === 0, 'Thursday closed despite forged Sunday');
  const afterClose = await directRequest('walkin.create', 'ALMUERZO', '2026-11-01', '11:30', reader('true').access,
    'supabase', new Date('2026-11-01T17:00:00Z'));
  assert(afterClose.status === 200 && afterClose.effective?.service === 'ALMUERZO', 'exact close enters walk-in late margin');
  const lateCutoff = await directRequest('walkin.create', 'ALMUERZO', '2026-11-01', '11:30', reader('true').access,
    'supabase', new Date('2026-11-01T17:30:01Z'));
  assert(lateCutoff.status === 409 && lateCutoff.writes === 0, 'after late boundary excluded');
  const beforeClose = await directRequest('walkin.create', 'ALMUERZO', '2026-11-01', '11:30', reader('true').access,
    'sheets', new Date('2026-11-01T16:59:59Z'));
  assert(beforeClose.status === 200 && beforeClose.writes === 1, 'one second before close allowed');
});

Deno.test('weekly walk-in accepts exact early and late margins with the Madrid server clock', async () => {
  const dinnerAtSix = rules.map((rule) => rule.service === 'CENA' ? { ...rule, start_time: '18:00:00' } : rule);
  for (const store of ['supabase', 'sheets'] as const) {
    const requestAt = (instant: string, service = 'CENA', services = 'ALMUERZO,CENA,BALINESA') =>
      directRequest('walkin.create', service, '2027-01-01', '20:00', reader('true', services, { rows: dinnerAtSix }).access,
        store, new Date(instant));
    const tooEarly = await requestAt('2026-10-29T16:29:59Z'); // 17:29:59 CET; dinner opens at 18:00.
    const boundary = await requestAt('2026-10-29T16:30:00Z');
    const arrival = await requestAt('2026-10-29T16:50:00Z');
    const closedService = await requestAt('2026-10-29T16:50:00Z', 'CENA', 'ALMUERZO,BALINESA');
    const otherDay = await requestAt('2026-10-29T16:50:00Z', 'ALMUERZO');
    assert(tooEarly.status === 409 && tooEarly.writes === 0, `${store}: before 17:30 rejected`);
    assert(boundary.status === 200 && boundary.effective?.service === 'CENA', `${store}: 17:30 inclusive`);
    assert(arrival.status === 200 && arrival.effective?.date === '2026-10-29'
      && arrival.effective.time === '17:50' && arrival.effective.service === 'CENA',
      `${store}: actual arrival and dinner assignment retained`);
    const late = await requestAt('2026-10-29T22:00:00Z'); // 23:00 CET, at service close.
    const lastSecond = await requestAt('2026-10-29T22:29:59Z');
    const boundaryLate = await requestAt('2026-10-29T22:30:00Z');
    const tooLate = await requestAt('2026-10-29T22:30:01Z');
    assert(late.status === 200 && lastSecond.status === 200 && boundaryLate.status === 200
      && tooLate.status === 409 && tooLate.writes === 0,
      `${store}: 30-minute post-close boundary is inclusive at 23:30`);
    assert(closedService.status === 409 && closedService.writes === 0, `${store}: globally disabled dinner rejects`);
    assert(otherDay.status === 409 && otherDay.writes === 0, `${store}: closed lunch rejects`);
  }
});

Deno.test('an actually open service wins over another service admission margin', async () => {
  const overlap = rules.map((rule) => rule.service === 'CENA' ? { ...rule, start_time: '17:45:00' } : rule);
  const result = await directRequest('walkin.create', 'CENA', '2027-01-01', '20:00',
    reader('true', 'ALMUERZO,CENA', { rows: overlap }).access, 'supabase', new Date('2026-11-01T16:30:00Z'));
  assert(result.status === 200 && result.effective?.service === 'ALMUERZO',
    'lunch open at 17:30 wins over early dinner');
});

Deno.test('legacy tenants keep the old path and do not read weekly rules', async () => {
  for (const flag of [undefined, 'false']) {
    const mock = reader(flag);
    const result = await directRequest('reservation.create', '', '2026-10-29', '03:00', mock.access, 'sheets');
    assert(result.status === 200 && result.writes === 1, 'legacy request remains accepted by guard');
    assert(mock.reads.join() === 'SETTINGS', 'legacy never reads weekly rules');
  }
});

Deno.test('server guard disabled preserves legacy creation without any SETTINGS read', async () => {
  const mock = reader('true', 'ALMUERZO', { readError: true });
  const result = await guardInternalWeeklyCreate('reservation.create',
    { service: '', date: '2026-10-29', time: '03:00' }, mock.access, new Date(), false);
  assert(result.mode === 'legacy' && mock.reads.length === 0, 'disabled guard does not add queries or rejections');
});

Deno.test('bad or unreadable active configuration rejects before writing; Balinesa remains independent', async () => {
  for (const store of ['supabase', 'sheets'] as const) {
    for (const mock of [reader('true', 'ALMUERZO', { badRules: true }), reader('true', 'ALMUERZO', { readError: true })]) {
      const result = await directRequest('reservation.create', 'ALMUERZO', '2026-11-01', '12:00', mock.access, store);
      assert(result.status === 503 && result.writes === 0, `${store}: invalid or unreadable weekly configuration`);
    }
    const disabled = await directRequest('reservation.create', 'ALMUERZO', '2026-11-01', '12:00', reader('true', 'BALINESA').access, store);
    assert(disabled.status === 409 && disabled.writes === 0, `${store}: globally disabled restaurant service`);
    const balineseReader = reader('true', 'BALINESA', { readError: true });
    const balinese = await directRequest('reservation.create', 'BALINESA', '2026-11-01', '', balineseReader.access, store);
    assert(balinese.status === 200 && balinese.writes === 1 && balineseReader.reads.length === 0,
      `${store}: Balinesa bypasses restaurant hours`);
  }
});

Deno.test('server Madrid clock handles midnight and CET/CEST transitions', () => {
  assert(madridNow(new Date('2026-10-29T23:30:00Z')).date === '2026-10-30', 'Madrid date after UTC midnight offset');
  assert(madridNow(new Date('2026-03-29T01:30:00Z')).time === '03:30:00', 'spring transition');
  assert(madridNow(new Date('2026-10-25T00:30:00Z')).time === '02:30:00', 'first repeated autumn hour');
  assert(madridNow(new Date('2026-10-25T01:30:00Z')).time === '02:30:00', 'second repeated autumn hour');
});
