import { capacitySettingsChanged, changedSettingValues, changedSettingsConflict } from '../src/utils/previewSettingsChanges.ts';
import { mockSettings } from '../src/data/mockData.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('partial general save sends only changed SETTINGS keys', () => {
  assert(Object.keys(changedSettingValues({ A: '1', B: '2' }, { A: '1', B: '2' })).length === 0,
    'unchanged general settings cause no remote save');
  assert(JSON.stringify(changedSettingValues({ A: '1', B: '2' }, { A: '1', B: '3' })) === JSON.stringify({ B: '3' }),
    'an unrelated key cannot be overwritten');
  const current = { SERVICES_ENABLED: 'ALMUERZO,CENA', BOOKING_INTERVAL: '30' };
  const changed = changedSettingValues(current, { ...current, BOOKING_INTERVAL: '60' });
  assert(JSON.stringify(changed) === JSON.stringify({ BOOKING_INTERVAL: '60' }),
    'an unchanged SERVICES_ENABLED must never be included in a general save');
});

Deno.test('general-only changes do not trigger capacity save', () => {
  assert(!capacitySettingsChanged(mockSettings, { ...mockSettings, reservasActivas: !mockSettings.reservasActivas }),
    'booking switch is a general setting, not a capacity edit');
  assert(capacitySettingsChanged(mockSettings, { ...mockSettings, totalCapacity: mockSettings.totalCapacity + 1 }),
    'capacity edits still require capacity save');
});

Deno.test('general save detects a newer remote value only for fields being edited', () => {
  const current = { A: 'TRUE', B: '2' };
  const changed = changedSettingValues(current, { A: 'FALSE', B: '2' });
  assert(!changedSettingsConflict(current, { A: 'TRUE', B: 'new' }, changed), 'unrelated remote edits remain untouched');
  assert(changedSettingsConflict(current, { A: 'FALSE', B: '2' }, changed), 'a concurrent edit to the same key blocks saving');
});
