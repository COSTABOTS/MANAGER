import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  filterPublicRestaurantSlotsByLeadTime,
  isPublicRestaurantSlotWithinLeadTime,
} from './reservations.ts';

const madrid = 'Europe/Madrid';

Deno.test('restaurant lead time compares exact seconds and milliseconds', () => {
  assert(!isPublicRestaurantSlotWithinLeadTime('2026-01-15', '12:30', new Date('2026-01-15T11:00:00.001Z'), madrid));
  assert(!isPublicRestaurantSlotWithinLeadTime('2026-01-15', '12:30', new Date('2026-01-15T11:00:01Z'), madrid));
  assert(isPublicRestaurantSlotWithinLeadTime('2026-01-15', '12:30', new Date('2026-01-15T11:00:00Z'), madrid));
  assert(isPublicRestaurantSlotWithinLeadTime('2026-01-15', '12:30', new Date('2026-01-15T10:59:59.999Z'), madrid));
});

Deno.test('restaurant lead time accepts ISO and sheet dates across midnight', () => {
  const now = new Date('2026-01-15T22:00:00.000Z');
  assert(isPublicRestaurantSlotWithinLeadTime('16/01/2026', '00:30', now, madrid));
  assert(!isPublicRestaurantSlotWithinLeadTime('15/01/2026', '22:29', now, madrid));
});

Deno.test('restaurant lead time uses CET and CEST offsets', () => {
  assert(isPublicRestaurantSlotWithinLeadTime('2026-01-15', '12:30', new Date('2026-01-15T11:00:00Z'), madrid));
  assert(isPublicRestaurantSlotWithinLeadTime('2026-07-15', '12:30', new Date('2026-07-15T10:00:00Z'), madrid));
  assert(isPublicRestaurantSlotWithinLeadTime('2026-10-25', '03:30', new Date('2026-10-25T01:00:00Z'), madrid));
});

Deno.test('invalid and nonexistent local times are not eligible', () => {
  assert(!isPublicRestaurantSlotWithinLeadTime('2026-03-29', '02:30', new Date('2026-03-29T00:00:00Z'), madrid));
  assert(!isPublicRestaurantSlotWithinLeadTime('2026-10-25', '02:30', new Date('2026-10-25T00:00:00Z'), madrid));
  assert(!isPublicRestaurantSlotWithinLeadTime('not-a-date', '12:30', new Date('2026-01-15T00:00:00Z'), madrid));
});

Deno.test('availability filtering preserves only slots at or beyond the boundary', () => {
  const now = new Date('2026-01-15T11:00:00Z');
  assertEquals(
    filterPublicRestaurantSlotsByLeadTime('2026-01-15', ['12:00', '12:29', '12:30', '13:00'], now, madrid),
    ['12:30', '13:00'],
  );
});
