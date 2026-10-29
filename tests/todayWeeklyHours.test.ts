import { getTodayWeeklyHoursLabel } from '../src/utils/todayWeeklyHours.ts';
import type { WeeklyHoursRow } from '../src/services/weeklyHoursApiContract.ts';

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
}

const sundayLunch: WeeklyHoursRow = { weekday: 0, service: 'ALMUERZO', enabled: true, start_time: '11:00:00', end_time: '18:00:00' };
const mondayLunch: WeeklyHoursRow = { weekday: 1, service: 'ALMUERZO', enabled: false, start_time: null, end_time: null };

Deno.test('HOY shows the saved Sunday interval and the closed Monday rule', () => {
  assertEqual(getTodayWeeklyHoursLabel('2026-11-01', 'ALMUERZO', [sundayLunch, mondayLunch]), 'Horario hoy: 11:00–18:00 (fin exclusivo)');
  assertEqual(getTodayWeeklyHoursLabel('2026-11-02', 'ALMUERZO', [sundayLunch, mondayLunch]), 'Cerrado hoy');
});

Deno.test('missing rule is unconfigured and Balinesa remains separate', () => {
  assertEqual(getTodayWeeklyHoursLabel('2026-11-01', 'CENA', [sundayLunch]), 'Cerrado · Sin configurar');
  assertEqual(getTodayWeeklyHoursLabel('2026-11-01', 'BALINESA', [sundayLunch]), null);
  assertEqual(getTodayWeeklyHoursLabel('2026-11-01', null, [sundayLunch]), null);
});

Deno.test('weekday calculation crosses year and CET/CEST without using browser timezone', () => {
  assertEqual(getTodayWeeklyHoursLabel('2027-01-03', 'ALMUERZO', [sundayLunch]), 'Horario hoy: 11:00–18:00 (fin exclusivo)');
  assertEqual(getTodayWeeklyHoursLabel('2026-03-29', 'ALMUERZO', [sundayLunch]), 'Horario hoy: 11:00–18:00 (fin exclusivo)');
  assertEqual(getTodayWeeklyHoursLabel('2026-10-25', 'ALMUERZO', [sundayLunch]), 'Horario hoy: 11:00–18:00 (fin exclusivo)');
  assertEqual(getTodayWeeklyHoursLabel('2026-02-30', 'ALMUERZO', [sundayLunch]), 'Horario no disponible');
});
