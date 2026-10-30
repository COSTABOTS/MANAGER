import { capacitySettingsChanged, changedSettingValues, changedSettingsConflict, serviceCapacitySlotsForSave } from '../src/utils/previewSettingsChanges.ts';
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

Deno.test('WEEKLY capacity never derives slots or defaults from legacy service hours', () => {
  const next = { ...mockSettings, bookingInterval: 60 as const, totalCapacity: mockSettings.totalCapacity + 1 };
  assert(!capacitySettingsChanged(mockSettings, next, true), 'interval and total capacity do not invent service slots');
  assert(serviceCapacitySlotsForSave({}, { start: '18:00', end: '22:00' }, 30, true).length === 0,
    'an open weekly service does not create capacity');
  const slots = serviceCapacitySlotsForSave({ '18:00': 2, '18:30': 0 }, { start: '17:00', end: '22:00' }, 30, true);
  assert(JSON.stringify(slots) === JSON.stringify([
    { hora: '18:00', limite: 2, activo: true },
    { hora: '18:30', limite: 0, activo: false },
  ]), 'weekly mode saves only explicitly configured capacity, including zero');
  assert(serviceCapacitySlotsForSave({}, { start: '18:00', end: '19:00' }, 30, false).length === 3,
    'legacy slot generation remains unchanged');
});

Deno.test('general save detects a newer remote value only for fields being edited', () => {
  const current = { A: 'TRUE', B: '2' };
  const changed = changedSettingValues(current, { A: 'FALSE', B: '2' });
  assert(!changedSettingsConflict(current, { A: 'TRUE', B: 'new' }, changed), 'unrelated remote edits remain untouched');
  assert(changedSettingsConflict(current, { A: 'FALSE', B: '2' }, changed), 'a concurrent edit to the same key blocks saving');
});
