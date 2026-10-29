import { getInactiveServiceReservations, getTodayTabServices } from '../src/utils/todayServices.ts';
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
