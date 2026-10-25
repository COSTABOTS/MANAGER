import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { evaluateDailyAvailability } from './availabilityByDay.ts';

Deno.test('daily availability is open without controls', () => assertEquals(evaluateDailyAvailability([], true, 'CENA'), { available: true, reason: 'open' }));
Deno.test('fully booked control blocks the day', () => assertEquals(evaluateDailyAvailability([{ fully_booked: true }], true, 'CENA'), { available: false, reason: 'fully_booked' }));
Deno.test('closed control blocks the day', () => assertEquals(evaluateDailyAvailability([{ status: 'closed' }], true, 'CENA'), { available: false, reason: 'closed' }));
Deno.test('disabled bookings take priority', () => assertEquals(evaluateDailyAvailability([{ fully_booked: true }], false, 'CENA'), { available: false, reason: 'bookings_disabled' }));
Deno.test('service-specific control applies', () => assertEquals(evaluateDailyAvailability([{ service: 'CENA', status: 'closed' }], true, 'CENA'), { available: false, reason: 'closed' }));
Deno.test('global control applies to CENA', () => assertEquals(evaluateDailyAvailability([{ service: null, status: 'closed' }], true, 'CENA'), { available: false, reason: 'closed' }));
Deno.test('weekly service disabled takes priority over an open day', () => assertEquals(evaluateDailyAvailability([], true, 'CENA', true, false), { available: false, reason: 'service_disabled' }));
Deno.test('weekly closed day is unavailable', () => assertEquals(evaluateDailyAvailability([], true, 'ALMUERZO', false, true), { available: false, reason: 'outside_weekly_hours' }));
Deno.test('daily availability does not claim capacity from an open schedule alone', () => {
  assertEquals(evaluateDailyAvailability([], true, 'ALMUERZO', true, true), { available: true, reason: 'open' });
});
