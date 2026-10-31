import { parseSharedCapacityResponse } from '../src/utils/sharedCapacity.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('shared capacity is read without confusing active and closed rows', () => {
  const parsed = parseSharedCapacityResponse({ ok: true, client_id: 'A', shared: [
    { hora: '18:00', limite: 20, activo: true },
    { hora: '18:30', limite: 20, activo: false },
  ] }, 'A');
  assert(parsed['18:00'] === 20 && parsed['18:30'] === 0,
    'only active shared capacity is treated as available');
});

Deno.test('capacity editor rejects an unverified or cross-tenant shared-capacity response', () => {
  for (const response of [
    { ok: true, client_id: 'B', shared: [] },
    { ok: true, client_id: 'A' },
    { ok: false, client_id: 'A', shared: [] },
  ]) {
    let rejected = false;
    try { parseSharedCapacityResponse(response, 'A'); } catch { rejected = true; }
    assert(rejected, 'capacity editor must not infer missing rows from an unverified response');
  }
});
