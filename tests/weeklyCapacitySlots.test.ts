import { weeklyCapacitySlotUnion } from '../src/utils/weeklyCapacitySlots.ts';
import type { WeeklyHoursRow } from '../src/services/weeklyHoursApiContract.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const services = ['DESAYUNO', 'ALMUERZO', 'CENA'] as const;
const closed: WeeklyHoursRow[] = Array.from({ length: 7 }, (_, weekday) => services.map((service) => ({
  weekday, service, enabled: false, start_time: null, end_time: null,
}))).flat();

function open(rows: WeeklyHoursRow[], weekday: number, service: WeeklyHoursRow['service'], start: string, end: string) {
  return rows.map((row) => row.weekday === weekday && row.service === service
    ? { ...row, enabled: true, start_time: `${start}:00`, end_time: `${end}:00` } : row);
}

Deno.test('capacity editor uses the union of all open weekdays and excludes service closing times', () => {
  let rules = open(closed, 0, 'ALMUERZO', '11:00', '16:00'); // Sunday
  rules = open(rules, 5, 'ALMUERZO', '12:00', '15:00'); // Friday
  rules = open(rules, 1, 'CENA', '18:00', '21:30'); // Monday
  rules = open(rules, 0, 'CENA', '19:00', '22:00'); // Sunday
  const slots = weeklyCapacitySlotUnion(rules, 30);
  assert(slots !== null, '21 valid rules are accepted');
  assert(slots.ALMUERZO[0] === '11:00' && slots.ALMUERZO.at(-1) === '15:30',
    'Sunday lunch adds 11:00 but closing at 16:00 is not reservable');
  assert(slots.ALMUERZO.length === 10 && new Set(slots.ALMUERZO).size === 10,
    'overlapping weekday hours are shown once per service');
  assert(slots.CENA[0] === '18:00' && slots.CENA.at(-1) === '21:30' && !slots.CENA.includes('22:00'),
    'dinner uses both weekday and weekend hours with an exclusive close');
  assert(slots.DESAYUNO.length === 0, 'a closed service creates no capacity slots');
  assert(slots.ALMUERZO.includes('19:00') === false && slots.CENA.includes('19:00'),
    'services retain independent capacity slots');
});

Deno.test('reservation interval changes the union without inventing any capacity value', () => {
  const rules = open(closed, 0, 'ALMUERZO', '11:00', '16:00');
  const slots = weeklyCapacitySlotUnion(rules, 60);
  assert(slots?.ALMUERZO.join(',') === '11:00,12:00,13:00,14:00,15:00',
    '60-minute interval preserves Sunday start and exclusive close');
  assert(Object.values(slots ?? {}).every((value) => value.every((slot) => typeof slot === 'string')),
    'the helper returns times only, never default capacities');
});

Deno.test('the same hour remains a separate capacity choice for each service', () => {
  let rules = open(closed, 0, 'ALMUERZO', '12:00', '14:00');
  rules = open(rules, 0, 'CENA', '12:00', '13:00');
  const slots = weeklyCapacitySlotUnion(rules, 30);
  assert(slots?.ALMUERZO.includes('12:00') && slots.CENA.includes('12:00'),
    'identical hours are retained under both independent services');
});

Deno.test('incomplete or invalid rules cannot produce an apparent weekly capacity schedule', () => {
  assert(weeklyCapacitySlotUnion(closed.slice(1), 30) === null, '20 rules rejected');
  assert(weeklyCapacitySlotUnion([...closed.slice(1), closed[1]], 30) === null, 'duplicate rejected');
  assert(weeklyCapacitySlotUnion(open(closed, 0, 'ALMUERZO', '16:00', '11:00'), 30) === null,
    'inverted service rejected');
});
