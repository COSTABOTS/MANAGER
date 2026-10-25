import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { getWeekday, isServiceOpenAt, validateWeeklyHoursConfig, type WeeklyHoursConfig } from './weeklyHours.ts';

const config: WeeklyHoursConfig = {
  0: { ALMUERZO: { enabled: true, start: '11:00', end: '18:00' }, CENA: { enabled: false, start: null, end: null } },
  1: { ALMUERZO: { enabled: true, start: '12:00', end: '16:00' }, CENA: { enabled: true, start: '19:00', end: '23:00' } },
};

Deno.test('weekday is Sunday=0 through Saturday=6', () => { assertEquals(getWeekday('2026-10-11'), 0); assertEquals(getWeekday('2026-10-12'), 1); assertEquals(getWeekday('2027-01-01'), 5); assertEquals(getWeekday('2026-02-30'), null); });
Deno.test('service uses inclusive start and exclusive end', () => { assert(isServiceOpenAt(config, '2026-10-12', 'ALMUERZO', '12:00')); assert(isServiceOpenAt(config, '2026-10-12', 'ALMUERZO', '15:59')); assert(!isServiceOpenAt(config, '2026-10-12', 'ALMUERZO', '16:00')); });
Deno.test('Sunday lunch and dinner can be configured independently', () => { assert(isServiceOpenAt(config, '2026-10-11', 'ALMUERZO', '11:00')); assert(isServiceOpenAt(config, '2026-10-11', 'ALMUERZO', '17:59')); assert(!isServiceOpenAt(config, '2026-10-11', 'ALMUERZO', '18:00')); assert(!isServiceOpenAt(config, '2026-10-11', 'CENA', '20:00')); });
Deno.test('absent configuration preserves legacy behavior', () => { assert(isServiceOpenAt({}, '2026-10-11', 'CENA', '03:00')); });
Deno.test('a day without active services is closed', () => { assert(!isServiceOpenAt({ 2: { CENA: { enabled: false, start: null, end: null } } }, '2026-10-13', 'CENA', '20:00')); });
Deno.test('30 and 60 minute intervals respect the same boundary', () => { for (const time of ['12:00', '12:30', '13:00', '15:30']) assert(isServiceOpenAt(config, '2026-10-12', 'ALMUERZO', time)); assert(!isServiceOpenAt(config, '2026-10-12', 'ALMUERZO', '16:00')); });
Deno.test('invalid rules are rejected', () => { assertEquals(validateWeeklyHoursConfig({ 1: { CENA: { enabled: true, start: '25:00', end: '23:00' } } }), ['1.CENA']); assertEquals(validateWeeklyHoursConfig({ 1: { CENA: { enabled: false, start: '19:00', end: '23:00' } } }), ['1.CENA:disabled-with-times']); });
Deno.test('cross-midnight rules are rejected in v1', () => { const overnight: WeeklyHoursConfig = { 6: { CENA: { enabled: true, start: '22:00', end: '02:00' } } }; assertEquals(validateWeeklyHoursConfig(overnight), ['6.CENA']); assert(!isServiceOpenAt(overnight, '2026-10-10', 'CENA', '23:00')); });
