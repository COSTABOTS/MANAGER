import { resolveWeeklyModeFromSettings } from '../src/utils/weeklyMode.ts';

function assert(actual: unknown, expected: unknown, caseName: string) {
  if (actual !== expected) throw new Error(`${caseName}: expected ${expected}, received ${actual}`);
}

Deno.test('Manager derives the tenant weekly mode only from verified SETTINGS values', () => {
  assert(resolveWeeklyModeFromSettings({}), 'legacy', 'absent flag');
  assert(resolveWeeklyModeFromSettings({ WEEKLY_HOURS_ENABLED: 'FALSE' }), 'legacy', 'disabled flag');
  assert(resolveWeeklyModeFromSettings({ WEEKLY_HOURS_ENABLED: 'TRUE' }), 'weekly', 'active flag');
  assert(resolveWeeklyModeFromSettings({ WEEKLY_HOURS_ENABLED: 'unexpected' }), 'unknown', 'invalid flag');
  assert(resolveWeeklyModeFromSettings([{ VARIABLE: 'WEEKLY_HOURS_ENABLED', VALUE: 'true' }]), 'weekly', 'row form');
});
