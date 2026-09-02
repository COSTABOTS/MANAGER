import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { hasExactlyOneWidgetResolveResult, isWidgetResolveClientUsable, resolveSlugField } from './widgetResolve.ts';

Deno.test('missing type preserves assistant slug resolution', () => assertEquals(resolveSlugField(null), 'assistant_slug'));
Deno.test('assistant type resolves assistant_slug', () => assertEquals(resolveSlugField('assistant'), 'assistant_slug'));
Deno.test('booking type resolves booking_slug', () => assertEquals(resolveSlugField('booking'), 'booking_slug'));
Deno.test('unknown type is rejected before query construction', () => assertEquals(resolveSlugField('admin'), null));
Deno.test('missing slug result remains not found', () => assertEquals(hasExactlyOneWidgetResolveResult([]), false));
Deno.test('duplicate result remains unusable defensively', () => assertEquals(hasExactlyOneWidgetResolveResult([{}, {}]), false));
Deno.test('suspended and expired clients remain unusable', () => {
  assertEquals(isWidgetResolveClientUsable({ status: 'SUSPENDED', public_token: 'token' }), false);
  assertEquals(isWidgetResolveClientUsable({ status: 'EXPIRED', public_token: 'token' }), false);
});
Deno.test('active client requires a public token', () => assertEquals(isWidgetResolveClientUsable({ status: 'ACTIVE', public_token: 'token' }), true));
