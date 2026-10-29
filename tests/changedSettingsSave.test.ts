import { saveChangedSections } from '../src/utils/changedSettingsSave.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('unified save calls only changed sections and reports each result independently', async () => {
  const calls: string[] = [];
  const results = await saveChangedSections([
    { name: 'General', changed: false, save: async () => { calls.push('general'); return true; } },
    { name: 'Semanal', changed: true, save: async () => { calls.push('weekly'); return false; } },
    { name: 'Piscina', changed: true, save: async () => { calls.push('pool'); return true; } },
  ]);
  assert(calls.join() === 'weekly,pool', 'unchanged general must not save');
  assert(JSON.stringify(results) === JSON.stringify([
    { name: 'Semanal', saved: false }, { name: 'Piscina', saved: true },
  ]), 'each section has its own result');
});

Deno.test('an unexpected section failure does not skip another changed section', async () => {
  let nextCalled = false;
  const results = await saveChangedSections([
    { name: 'General', changed: true, save: async () => { throw new Error('network'); } },
    { name: 'Piscina', changed: true, save: async () => { nextCalled = true; return true; } },
  ]);
  assert(nextCalled && !results[0].saved && results[1].saved, 'individual failures remain visible');
});
