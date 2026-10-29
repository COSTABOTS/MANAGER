import {
  copyWeeklyRuleToOtherDays,
  createWeeklyHoursDraft,
  isCompleteWeeklyDraft,
  isValidWeeklyRule,
  parseWeeklyHoursDraft,
  toWeeklyHoursRows,
  updateWeeklyRule,
} from '../src/utils/weeklyHoursDraft.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('the draft always has 21 closed rules and does not create capacity', () => {
  const rows = toWeeklyHoursRows(createWeeklyHoursDraft());
  assert(rows.length === 21, 'expected seven days for each restaurant service');
  assert(rows.every((row) => !row.enabled && row.start_time === null && row.end_time === null), 'initial draft must be closed');
  assert(rows.every((row) => !('capacity' in row)), 'schedule must not contain capacity');
  assert(rows.some((row) => row.weekday === 0 && row.service === 'ALMUERZO'), 'Sunday must be weekday 0');
});

Deno.test('Grand Italia can open lunch only on Sunday while dinner stays independent', () => {
  const draft = updateWeeklyRule(createWeeklyHoursDraft(), 'ALMUERZO', 0, { enabled: true, start: '11:00', end: '18:00' });
  const rows = toWeeklyHoursRows(draft);
  assert(isCompleteWeeklyDraft(draft), 'Sunday-only schedule should be complete');
  assert(rows.filter((row) => row.service === 'ALMUERZO' && row.enabled).length === 1, 'only Sunday lunch should be open');
  assert(rows.find((row) => row.weekday === 0 && row.service === 'ALMUERZO')?.end_time === '18:00', 'end time should be retained');
  assert(rows.every((row) => row.service !== 'CENA' || !row.enabled), 'dinner should remain independent');
});

Deno.test('closing a day keeps local times but emits null SQL times', () => {
  let draft = updateWeeklyRule(createWeeklyHoursDraft(), 'CENA', 1, { enabled: true, start: '19:00', end: '23:00' });
  draft = updateWeeklyRule(draft, 'CENA', 1, { enabled: false });
  assert(draft.CENA[1].start === '19:00', 'local draft should retain times for reopening');
  const row = toWeeklyHoursRows(draft).find((item) => item.weekday === 1 && item.service === 'CENA');
  assert(row?.start_time === null && row.end_time === null, 'closed SQL rule should omit times');
});

Deno.test('time validation rejects empty, equal, inverted and overnight ranges', () => {
  assert(!isValidWeeklyRule({ enabled: true, start: '', end: '18:00' }), 'empty start should fail');
  assert(!isValidWeeklyRule({ enabled: true, start: '18:00', end: '18:00' }), 'equal times should fail');
  assert(!isValidWeeklyRule({ enabled: true, start: '19:00', end: '11:00' }), 'overnight should fail');
  assert(!isValidWeeklyRule({ enabled: true, start: '25:00', end: '26:00' }), 'invalid time should fail');
  assert(isValidWeeklyRule({ enabled: true, start: '11:00', end: '18:00' }), 'valid interval should pass');
});

Deno.test('copying a day changes only the selected service', () => {
  let draft = updateWeeklyRule(createWeeklyHoursDraft(), 'ALMUERZO', 0, { enabled: true, start: '11:00', end: '18:00' });
  draft = updateWeeklyRule(draft, 'CENA', 1, { enabled: true, start: '19:00', end: '23:00' });
  const copied = copyWeeklyRuleToOtherDays(draft, 'ALMUERZO', 0);
  assert(Object.values(copied.ALMUERZO).every((rule) => rule.enabled && rule.start === '11:00'), 'lunch should be copied');
  assert(copied.CENA[1].start === '19:00', 'dinner should not change');
  assert(draft.ALMUERZO[1].enabled === false, 'source draft should remain unchanged');
});

Deno.test('a saved local draft round-trips and malformed drafts are rejected', () => {
  const draft = updateWeeklyRule(createWeeklyHoursDraft(), 'DESAYUNO', 2, { enabled: true, start: '08:00', end: '11:00' });
  const restored = parseWeeklyHoursDraft(JSON.parse(JSON.stringify(draft)));
  assert(restored?.DESAYUNO[2].start === '08:00', 'saved time should be restored');
  assert(parseWeeklyHoursDraft({ DESAYUNO: {} }) === null, 'partial 21-rule draft should be rejected');
  assert(parseWeeklyHoursDraft(null) === null, 'missing draft should be rejected');
});
