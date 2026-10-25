import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isServiceOpenAt } from './weeklyHours.ts';
import { loadWeeklyHours, resolveWeeklyHours, type BookingServiceHoursRow, type WeeklyHoursDbClient } from './weeklyHoursAdapter.ts';

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
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: table === 'SETTINGS' ? settings : bookingRows, error: table === 'SETTINGS' ? settingsError : null }),
      };
      return chain;
    },
  };
}

Deno.test('legacy loading does not query booking_service_hours', async () => {
  const db = mockDb([{ CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'false' }]);
  const result = await loadWeeklyHours(db as WeeklyHoursDbClient, 'TEST');
  assertEquals(result.mode, 'legacy');
  assertEquals(db.calls, ['SETTINGS']);
});

Deno.test('active loading reads the 21 booking rules and services setting', async () => {
  const db = mockDb([
    { CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'true' },
    { CLAVE: 'SERVICES_ENABLED', VALOR: 'ALMUERZO,CENA' },
  ], rows());
  const result = await loadWeeklyHours(db as WeeklyHoursDbClient, 'TEST');
  assertEquals(result.mode, 'weekly');
  if (result.mode === 'weekly') assertEquals([...result.servicesEnabled ?? []], ['ALMUERZO', 'CENA']);
  assertEquals(db.calls, ['SETTINGS', 'booking_service_hours']);
});
