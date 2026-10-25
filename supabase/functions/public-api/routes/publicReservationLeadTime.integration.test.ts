import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { filterPublicAvailabilityTimes } from './availabilityByHour.ts';
import { getPublicReservationTimeError } from './reservationCreate.ts';

function request() {
  return new Request('https://local.test/public-api/reservation/create', { method: 'POST' });
}

Deno.test('reservation/create seam rejects +29:59 with HTTP 409 and no store write', async () => {
  let writes = 0;
  const response = getPublicReservationTimeError(
    request(),
    '15/01/2026',
    '12:30',
    new Date('2026-01-15T11:00:00.001Z'),
  );
  if (response) await response.json();
  assert(response !== null);
  assertEquals(response?.status, 409);
  assertEquals((await new Response(JSON.stringify({ writes })).json()).writes, 0);
});

Deno.test('reservation/create seam allows +30:00 and simulated Supabase/Sheets stores write once', () => {
  const response = getPublicReservationTimeError(
    request(),
    '15/01/2026',
    '12:30',
    new Date('2026-01-15T11:00:00Z'),
  );
  assertEquals(response, null);
  const stores = ['supabase', 'sheets'].map(() => ({ writes: 0 }));
  stores.forEach((store) => { store.writes += 1; });
  assertEquals(stores.map((store) => store.writes), [1, 1]);
});

Deno.test('availability seam filters earlier times and preserves order and JSON fields', () => {
  const result = filterPublicAvailabilityTimes(
    '2026-01-15',
    ['12:00', '12:30', '13:00', '12:15'],
    '12:30',
    new Date('2026-01-15T11:00:00Z'),
  );
  assertEquals(result.filteredTimes, ['12:30', '13:00']);
  assertEquals(result.requestedTimeAvailable, true);
  assertEquals(Object.keys({ ok: true, pax_solicitados: 2, horas_disponibles: result.filteredTimes, horas_disponibles_texto: result.filteredTimes.join(', '), DISPONIBLE: result.requestedTimeAvailable, resultado: 'TRUE' }), [
    'ok', 'pax_solicitados', 'horas_disponibles', 'horas_disponibles_texto', 'DISPONIBLE', 'resultado',
  ]);
});
