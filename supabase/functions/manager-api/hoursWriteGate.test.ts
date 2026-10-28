import { canWriteRemoteHours, hoursAuthFailureStatus } from './hoursWriteGate.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('server hours-write gate is closed unless both controls are explicit', () => {
  for (const enabled of [undefined, '', 'false', 'TRUE', '1']) {
    assert(!canWriteRemoteHours('A', enabled, 'A'), 'only literal true enables the gate');
  }
  assert(!canWriteRemoteHours('A', 'true', undefined), 'missing allowlist stays closed');
  assert(!canWriteRemoteHours('', 'true', 'A'), 'missing resolved tenant stays closed');
});

Deno.test('server hours-write gate matches exact resolved client_id', () => {
  assert(canWriteRemoteHours('A', 'true', 'B, A'), 'listed tenant is allowed');
  assert(!canWriteRemoteHours('B', 'true', 'A'), 'other tenant is denied');
  assert(!canWriteRemoteHours('A', 'true', 'AA'), 'partial match is denied');
  assert(!canWriteRemoteHours('A', 'true', '*'), 'wildcard is not recognized');
});

Deno.test('new hours actions report lost authentication with HTTP 401 without changing legacy actions', () => {
  for (const action of ['weeklyHours.get', 'weeklyHours.save', 'poolHours.get', 'poolHours.save']) {
    assert(hoursAuthFailureStatus(action) === 401, 'hours action requires HTTP 401');
  }
  assert(hoursAuthFailureStatus('settings.save') === 200, 'legacy response status remains unchanged');
});
