import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isServiceOpenAt } from './weeklyHours.ts';
import { loadWeeklyHours, resolveWeeklyHours, type BookingServiceHoursRow, type WeeklyHoursDbQuery } from './weeklyHoursAdapter.ts';

const rows = (): BookingServiceHoursRow[] => Array.from({ length: 7 }, (_, weekday) =>
  ['DESAYUNO', 'ALMUERZO', 'CENA'].map((service) => ({
    weekday, service, enabled: service === 'ALMUERZO' && weekday === 0,
    start_time: service === 'ALMUERZO' && weekday === 0 ? '11:00:00' : null,
    end_time: service === 'ALMUERZO' && weekday === 0 ? '18:00:00' : null,
  }))).flat();

Deno.test('adapts Sunday lunch and closed dinner', () => {
  const result = resolveWeeklyHours('true', rows());
  assertEquals(result.mode, 'weekly');
  if (result.mode !== 'weekly') return;
  assert(isServiceOpenAt(result.config, '2026-10-11', 'ALMUERZO', '11:00'));
  assert(!isServiceOpenAt(result.config, '2026-10-11', 'ALMUERZO', '18:00'));
  assert(!isServiceOpenAt(result.config, '2026-10-11', 'CENA', '20:00'));
});

Deno.test('legacy flag absent or false bypasses weekly rows', () => {
  assertEquals(resolveWeeklyHours(undefined, rows()).mode, 'legacy');
  assertEquals(resolveWeeklyHours('false', rows()).mode, 'legacy');
});

Deno.test('enabled requires complete configuration', () => {
  assertEquals(resolveWeeklyHours(true, rows().slice(0, 20)).mode, 'error');
});

Deno.test('read errors are distinct from missing configuration', () => {
  const enabledResult = resolveWeeklyHours(true, null, new Error('db'));
  const disabledResult = resolveWeeklyHours(false, null, new Error('db'));
  assertEquals(enabledResult.mode, 'error');
  assertEquals(disabledResult.mode, 'error');
  if (enabledResult.mode === 'error' && disabledResult.mode === 'error') {
    assertEquals(enabledResult.error.code, 'WEEKLY_HOURS_CONFIG_READ_FAILED');
    assertEquals(disabledResult.error.code, 'WEEKLY_HOURS_CONFIG_READ_FAILED');
  }
});

Deno.test('accepts start/end aliases and PostgreSQL HH:mm:ss with zero seconds', () => {
  const input = rows().map((row) => ({ ...row, start_time: undefined, end_time: undefined, start: row.start_time, end: row.end_time }));
  const result = resolveWeeklyHours(true, input);
  assertEquals(result.mode, 'weekly');
  if (result.mode === 'weekly') assertEquals(result.config[0]?.ALMUERZO, { enabled: true, start: '11:00', end: '18:00' });
});

Deno.test('rejects non-zero seconds instead of truncating them', () => {
  const input = rows(); input[1] = { ...input[1], start_time: '11:00:30' };
  assertEquals(resolveWeeklyHours(true, input).mode, 'error');
});

Deno.test('rejects duplicate and invalid services', () => {
  const duplicate = rows(); duplicate[1] = { ...duplicate[0] };
  assertEquals(resolveWeeklyHours(true, duplicate).mode, 'error');
  const invalid = rows(); invalid[0] = { ...invalid[0], service: 'SNACK' };
  assertEquals(resolveWeeklyHours(true, invalid).mode, 'error');
});

Deno.test('closed days and service rules stay separate from capacity', () => {
  const result = resolveWeeklyHours(true, rows());
  assertEquals(result.mode, 'weekly');
  if (result.mode === 'weekly') assert(!isServiceOpenAt(result.config, '2026-10-12', 'ALMUERZO', '12:00'));
});

function mockDb(settings: unknown[], bookingRows: unknown[] = [], settingsError: { message: string } | null = null) {
  const calls: string[] = [];
  const filters: Array<{ table: string; method: string; column: string; value: unknown }> = [];
  return {
    calls,
    filters,
    reader(): { readSettings(): Promise<WeeklyHoursDbQuery>; readRules(): Promise<WeeklyHoursDbQuery> } {
      return {
        readSettings: async () => {
          calls.push('SETTINGS');
          filters.push({ table: 'SETTINGS', method: 'eq', column: 'CLIENTE_ID', value: 'TEST' });
          filters.push({ table: 'SETTINGS', method: 'in', column: 'CLAVE', value: ['WEEKLY_HOURS_ENABLED', 'SERVICES_ENABLED'] });
          return { data: settings, error: settingsError };
        },
        readRules: async () => {
          calls.push('booking_service_hours');
          filters.push({ table: 'booking_service_hours', method: 'eq', column: 'client_id', value: 'TEST' });
          return { data: bookingRows, error: null };
        },
      };
    },
  };
}

Deno.test('legacy loading does not query booking_service_hours', async () => {
  const db = mockDb([{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'false' }]);
  const result = await loadWeeklyHours(db.reader());
  assertEquals(result.mode, 'legacy');
  assertEquals(db.calls, ['SETTINGS']);
});

Deno.test('active loading reads the 21 booking rules and services setting', async () => {
  const db = mockDb([
    { CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'true' },
    { CLAVE: 'SERVICES_ENABLED', VALOR: 'ALMUERZO,CENA,BALINESA' },
  ], rows());
  const result = await loadWeeklyHours(db.reader());
  assertEquals(result.mode, 'weekly');
  if (result.mode === 'weekly') assertEquals([...result.servicesEnabled ?? []], ['ALMUERZO', 'CENA']);
  assertEquals(db.calls, ['SETTINGS', 'booking_service_hours']);
  assertEquals(db.filters, [
    { table: 'SETTINGS', method: 'eq', column: 'CLIENTE_ID', value: 'TEST' },
    { table: 'SETTINGS', method: 'in', column: 'CLAVE', value: ['WEEKLY_HOURS_ENABLED', 'SERVICES_ENABLED'] },
    { table: 'booking_service_hours', method: 'eq', column: 'client_id', value: 'TEST' },
  ]);
});

Deno.test('active weekly hours default missing or empty SERVICES_ENABLED to CENA only', async () => {
  for (const settings of [
    [{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'true' }],
    [{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'true' }, { CLAVE: 'SERVICES_ENABLED', VALOR: '' }],
  ]) {
    const result = await loadWeeklyHours(mockDb(settings, rows()).reader());
    assertEquals(result.mode, 'weekly');
    if (result.mode !== 'weekly') throw new Error('Expected weekly hours');
    assertEquals([...result.servicesEnabled ?? []], ['CENA']);
  }
});

Deno.test('BALINESA alone does not enable any weekly restaurant service', async () => {
  const result = await loadWeeklyHours(mockDb([
    { CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'true' },
    { CLAVE: 'SERVICES_ENABLED', VALOR: 'BALINESA' },
  ], rows()).reader());
  assertEquals(result.mode, 'weekly');
  if (result.mode !== 'weekly') throw new Error('Expected weekly hours');
  assertEquals([...result.servicesEnabled ?? []], []);
});

Deno.test('explicit restaurant services accept whitespace separators consistently with SQL', async () => {
  const result = await loadWeeklyHours(mockDb([
    { CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'true' },
    { CLAVE: 'SERVICES_ENABLED', VALOR: 'ALMUERZO CENA BALINESA' },
  ], rows()).reader());
  assertEquals(result.mode, 'weekly');
  if (result.mode !== 'weekly') throw new Error('Expected weekly hours');
  assertEquals([...result.servicesEnabled ?? []], ['ALMUERZO', 'CENA']);
});
