import { createWeeklyHoursDraft, updateWeeklyRule, toWeeklyHoursRows } from '../src/utils/weeklyHoursDraft.ts';
import { initialPreviewServices, parsePreviewServices, summarizeWeeklyDraft } from '../src/utils/weeklyHoursPreviewDraft.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('Preview services are local data and a saved selection remains separate from 21 rules', () => {
  const services = initialPreviewServices(['ALMUERZO', 'BALINESA']);
  assert(services.ALMUERZO && !services.CENA && !services.DESAYUNO, 'only restaurant services are represented');
  const restored = parsePreviewServices(JSON.parse(JSON.stringify(services)));
  assert(restored?.ALMUERZO === true && restored.CENA === false, 'local selection round-trips');
  assert(parsePreviewServices({ ALMUERZO: true }) === null, 'partial selection is rejected');
  assert(toWeeklyHoursRows(createWeeklyHoursDraft()).length === 21, 'service selection does not alter the 21 rules');
});

Deno.test('summary groups identical weekdays and keeps a gap between lunch and dinner', () => {
  let draft = createWeeklyHoursDraft();
  for (const day of [1, 2, 3, 4, 5, 6]) {
    draft = updateWeeklyRule(draft, 'ALMUERZO', day, { enabled: true, start: '12:00', end: '16:00' });
    draft = updateWeeklyRule(draft, 'CENA', day, { enabled: true, start: '19:00', end: '23:00' });
  }
  draft = updateWeeklyRule(draft, 'ALMUERZO', 0, { enabled: true, start: '11:00', end: '18:00' });
  const summary = summarizeWeeklyDraft(draft, initialPreviewServices(['ALMUERZO', 'CENA']));
  assert(summary?.length === 2, 'six equal days should be grouped');
  assert(summary[0].days.length === 6 && summary[0].turns.join('|') === '12:00–16:00|19:00–23:00', 'separate turns must not imply opening in the gap');
  assert(summary[1].days[0] === 'Domingo' && summary[1].turns[0] === '11:00–18:00', 'Sunday schedule remains distinct');
});

Deno.test('closed services and days preserve their rules but disappear from summary', () => {
  let draft = updateWeeklyRule(createWeeklyHoursDraft(), 'CENA', 1, { enabled: true, start: '19:00', end: '23:00' });
  const closed = summarizeWeeklyDraft(draft, initialPreviewServices([]));
  assert(closed?.length === 1 && closed[0].days.length === 7 && closed[0].turns.length === 0, 'all days are closed in local preview');
  assert(draft.CENA[1].start === '19:00', 'turning off a service does not discard its hours');
  draft = updateWeeklyRule(draft, 'CENA', 1, { enabled: false });
  assert(draft.CENA[1].start === '19:00', 'closing a day keeps its saved times');
});

Deno.test('touching intervals merge; overlapping intervals do not appear as separate openings', () => {
  let draft = createWeeklyHoursDraft();
  draft = updateWeeklyRule(draft, 'DESAYUNO', 1, { enabled: true, start: '08:00', end: '12:00' });
  draft = updateWeeklyRule(draft, 'ALMUERZO', 1, { enabled: true, start: '11:00', end: '16:00' });
  draft = updateWeeklyRule(draft, 'CENA', 1, { enabled: true, start: '16:00', end: '23:00' });
  const summary = summarizeWeeklyDraft(draft, initialPreviewServices(['DESAYUNO', 'ALMUERZO', 'CENA']));
  assert(summary?.[0].turns.join('|') === '08:00–23:00', 'continuous opening should be one turn');
});

Deno.test('invalid open hours never produce a misleading summary', () => {
  const draft = updateWeeklyRule(createWeeklyHoursDraft(), 'ALMUERZO', 0, { enabled: true, start: '18:00', end: '11:00' });
  assert(summarizeWeeklyDraft(draft, initialPreviewServices(['ALMUERZO'])) === null, 'invalid hours block the summary');
});
