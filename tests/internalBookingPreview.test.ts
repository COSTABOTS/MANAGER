import { attemptWalkInCreate, getMadridClock, getManualRestaurantServices, getManualRestaurantSlots, getOpenRestaurantServiceAt } from '../src/utils/internalBookingPreview.ts';
import type { WeeklyHoursRow } from '../src/services/weeklyHoursApiContract.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const rows: WeeklyHoursRow[] = Array.from({ length: 7 }, (_, weekday) =>
  (['DESAYUNO', 'ALMUERZO', 'CENA'] as const).map((service) => ({
    weekday, service,
    enabled: service === 'CENA' || (service === 'ALMUERZO' && weekday === 0),
    start_time: service === 'CENA' ? '19:00:00' : service === 'ALMUERZO' && weekday === 0 ? '11:00:00' : null,
    end_time: service === 'CENA' ? '23:00:00' : service === 'ALMUERZO' && weekday === 0 ? '18:00:00' : null,
  }))).flat();
const enabled = ['ALMUERZO', 'CENA', 'BALINESA'] as const;

Deno.test('walk-in requires a globally enabled service open at the current Madrid time', () => {
  assert(getOpenRestaurantServiceAt(enabled, { date: '2026-11-01', time: '11:00:00' }, rows) === 'ALMUERZO', 'start inclusive');
  assert(getOpenRestaurantServiceAt(enabled, { date: '2026-11-01', time: '17:59:59' }, rows) === 'ALMUERZO', 'before close');
  assert(getOpenRestaurantServiceAt(enabled, { date: '2026-11-01', time: '18:00:00' }, rows) === null, 'end exclusive');
  assert(getOpenRestaurantServiceAt(enabled, { date: '2026-10-29', time: '12:00:00' }, rows) === null, 'Thursday lunch closed');
  assert(getOpenRestaurantServiceAt(enabled, { date: '2026-10-29', time: '19:30:00' }, rows) === 'CENA', 'dinner open');
  assert(getOpenRestaurantServiceAt(['ALMUERZO', 'BALINESA'], { date: '2026-10-29', time: '19:30:00' }, rows) === null,
    'weekly hours cannot reactivate a globally disabled service');
  assert(getOpenRestaurantServiceAt(['BALINESA'], { date: '2026-11-01', time: '11:30:00' }, rows) === null,
    'Balinesa is independent and never chosen as restaurant walk-in');
});

Deno.test('walk-in requires the service to be open at the actual arrival time', () => {
  const dinnerAtSix = rows.map((row) => row.service === 'CENA'
    ? { ...row, start_time: '18:00:00' } : row);
  const serviceAt = (time: string, services: readonly ('ALMUERZO' | 'CENA' | 'BALINESA')[] = enabled) =>
    getOpenRestaurantServiceAt(services, { date: '2026-10-29', time }, dinnerAtSix);
  assert(serviceAt('17:44:59') === null, 'before the service');
  assert(serviceAt('17:45:00') === null, 'early admission is disabled');
  assert(serviceAt('17:50:00') === null, '17:50 cannot be assigned to an 18:00 dinner');
  assert(serviceAt('18:00:00') === 'CENA', 'service start remains inclusive');
  assert(serviceAt('23:00:00') === null, 'service end remains exclusive');
  assert(serviceAt('17:50:00', ['ALMUERZO', 'BALINESA']) === null, 'disabled dinner cannot open early');
  assert(getOpenRestaurantServiceAt(enabled, { date: '2026-10-30', time: '01:29:00' }, dinnerAtSix) === null,
    '01:29 cannot become a breakfast walk-in');
  assert(getOpenRestaurantServiceAt(enabled, { date: '2026-10-30', time: '10:50:00' }, dinnerAtSix) === null,
    'another day does not inherit an early opening');
});

Deno.test('failed or incomplete weekly read never enables a new internal reservation in Preview', () => {
  const clock = { date: '2026-11-01', time: '11:30:00' };
  assert(getOpenRestaurantServiceAt(enabled, clock, null) === null, 'read failure closes walk-in');
  assert(getOpenRestaurantServiceAt(enabled, clock, rows.slice(0, 20)) === null, 'incomplete schedule closes walk-in');
  assert(getManualRestaurantServices(enabled, clock.date, null).length === 0, 'read failure closes manual service choices');
  assert(getManualRestaurantSlots(enabled, clock.date, 'ALMUERZO', null, 30).length === 0, 'read failure closes manual times');
});

Deno.test('manual service and times follow the selected date with exclusive end', () => {
  assert(getManualRestaurantServices(enabled, '2026-10-29', rows).join() === 'CENA', 'Thursday has only dinner');
  assert(getManualRestaurantServices(enabled, '2026-11-01', rows).join() === 'ALMUERZO,CENA', 'Sunday has lunch and dinner');
  const sundayLunch = getManualRestaurantSlots(enabled, '2026-11-01', 'ALMUERZO', rows, 60);
  assert(sundayLunch[0] === '11:00' && sundayLunch.at(-1) === '17:00' && !sundayLunch.includes('18:00'), 'end excluded');
  assert(getManualRestaurantSlots(enabled, '2026-10-29', 'ALMUERZO', rows, 30).length === 0, 'closed date has no times');
  assert(getManualRestaurantSlots([], '2026-11-01', 'ALMUERZO', rows, 30).length === 0, 'disabled service has no times');
});

Deno.test('Madrid clock follows CET, CEST and the repeated autumn hour from real instants', () => {
  assert(JSON.stringify(getMadridClock(new Date('2026-03-29T00:30:00Z'))) === JSON.stringify({ date: '2026-03-29', time: '01:30:00' }), 'before spring change');
  assert(JSON.stringify(getMadridClock(new Date('2026-03-29T01:30:00Z'))) === JSON.stringify({ date: '2026-03-29', time: '03:30:00' }), 'after spring change');
  assert(getMadridClock(new Date('2026-10-25T00:30:00Z')).time === '02:30:00', 'first autumn hour');
  assert(getMadridClock(new Date('2026-10-25T01:30:00Z')).time === '02:30:00', 'repeated autumn hour');
  assert(getMadridClock(new Date('2026-10-29T23:30:00Z')).date === '2026-10-30', 'Madrid midnight independent of UTC date');
});

Deno.test('failed walk-in API call cannot produce the successful form reset path', async () => {
  let attempts = 0;
  const created = await attemptWalkInCreate(async () => { attempts++; throw new Error('API_UNAVAILABLE'); });
  assert(!created && attempts === 1, 'a rejected create must keep the entered form values');
  const success = await attemptWalkInCreate(async () => { attempts++; });
  assert(success && Number(attempts) === 2, 'only a confirmed create permits clearing the form');
});
