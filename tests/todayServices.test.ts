import { getInactiveServiceReservations, getScheduledTodayTabs, getTodayTabServices } from '../src/utils/todayServices.ts';
import type { WeeklyHoursRow } from '../src/services/weeklyHoursApiContract.ts';
import type { Reservation } from '../src/types.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('HOY never invents CENA when no service is enabled', () => {
  assert(getTodayTabServices([]).length === 0, 'zero enabled services means zero usual tabs');
  assert(getTodayTabServices(['BALINESA']).join() === 'BALINESA', 'Balinesa stays independent');
  assert(getTodayTabServices(['CENA', 'DESAYUNO']).join() === 'DESAYUNO,CENA', 'usual tabs keep fixed order');
});

Deno.test('existing reservations of disabled services remain in the operative list', () => {
  const reservations = [
    { id: 'lunch', service: 'ALMUERZO' },
    { id: 'dinner', service: 'CENA' },
    { id: 'pool', service: 'BALINESA' },
    { id: 'legacy-without-service' },
  ] as Reservation[];
  const inactive = getInactiveServiceReservations(reservations, ['CENA']);
  assert(inactive.map((reservation) => reservation.id).join() === 'lunch,pool', 'disabled services preserved');
  assert(getInactiveServiceReservations(reservations, []).length === 4, 'all reservations visible when all services are off');
});

Deno.test('weekly HOY tabs omit a closed Thursday lunch but keep Sunday lunch and Balinesa', () => {
  const rows: WeeklyHoursRow[] = Array.from({ length: 7 }, (_, weekday) =>
    (['DESAYUNO', 'ALMUERZO', 'CENA'] as const).map((service) => ({
      weekday, service, enabled: service === 'CENA' || (service === 'ALMUERZO' && weekday === 0),
      start_time: service === 'ALMUERZO' && weekday === 0 ? '11:00:00' : service === 'CENA' ? '19:00:00' : null,
      end_time: service === 'ALMUERZO' && weekday === 0 ? '18:00:00' : service === 'CENA' ? '23:00:00' : null,
    }))).flat();
  const enabled = ['ALMUERZO', 'CENA', 'BALINESA'] as const;
  const thursday = getScheduledTodayTabs(enabled, '2026-10-29', rows);
  const sunday = getScheduledTodayTabs(enabled, '2026-11-01', rows);
  assert(thursday.status === 'ready' && thursday.tabs.join() === 'CENA,BALINESA', 'closed lunch hidden Thursday');
  assert(sunday.status === 'ready' && sunday.tabs.join() === 'ALMUERZO,CENA,BALINESA', 'Sunday lunch visible');
  assert(getInactiveServiceReservations([{ id: 'existing', service: 'ALMUERZO' } as Reservation], thursday.tabs).length === 1,
    'closed service reservation remains operative');
  assert(getScheduledTodayTabs(enabled, '2026-10-29', []).tabs.join() === 'ALMUERZO,CENA,BALINESA', 'unconfigured uses previous tabs');
  assert(getScheduledTodayTabs(enabled, '2026-10-29', rows.slice(0, 20)).status === 'unavailable', 'incomplete rows use previous tabs');
  assert(getScheduledTodayTabs(enabled, '2026-10-29', null).status === 'unavailable', 'failed read uses previous tabs');
});
