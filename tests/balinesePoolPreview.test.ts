import {
  balinesePoolStorageKey,
  emptyBalinesePoolDraft,
  evaluateBalinesePoolCutoff,
  isValidPoolHours,
  loadBalinesePoolDraft,
  parseBalinesePoolDraft,
  saveBalinesePoolDraft,
} from '../src/utils/balinesePoolPreview.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('pool draft has no invented hours and is isolated per restaurant', () => {
  const empty = emptyBalinesePoolDraft();
  assert(!empty.enabled && !empty.openingTime && !empty.closingTime, 'initial draft must not imply actual pool hours');
  assert(balinesePoolStorageKey('restaurant-a') !== balinesePoolStorageKey('restaurant-b'), 'storage keys must be tenant-scoped');
  const configured = { enabled: true, openingTime: '10:00', closingTime: '19:00' };
  assert(parseBalinesePoolDraft(JSON.parse(JSON.stringify(configured)))?.closingTime === '19:00', 'local draft must round-trip');
  assert(parseBalinesePoolDraft({ enabled: true }) === null, 'partial draft must not be accepted');
  assert(parseBalinesePoolDraft({ enabled: false, openingTime: '10:00', closingTime: '19:00' })?.openingTime === '10:00', 'disabling must preserve saved hours');
});

Deno.test('local reload preserves hours after disabling and does not mix restaurants', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  saveBalinesePoolDraft('restaurant-a', { enabled: true, openingTime: '10:00', closingTime: '19:00' }, storage);
  saveBalinesePoolDraft('restaurant-a', { ...loadBalinesePoolDraft('restaurant-a', storage), enabled: false }, storage);
  assert(loadBalinesePoolDraft('restaurant-a', storage).openingTime === '10:00', 'disabled service keeps its opening time after reload');
  assert(loadBalinesePoolDraft('restaurant-a', storage).closingTime === '19:00', 'disabled service keeps its closing time after reload');
  assert(loadBalinesePoolDraft('restaurant-b', storage).openingTime === '', 'another restaurant starts without invented hours');
  assert(values.size === 1, 'only the selected restaurant key is written');
});

Deno.test('opening and closing times must be valid and ordered', () => {
  assert(isValidPoolHours('10:00', '19:00'), 'normal hours are valid');
  assert(!isValidPoolHours('', '19:00'), 'missing opening is invalid');
  assert(!isValidPoolHours('19:00', '19:00'), 'equal hours are invalid');
  assert(!isValidPoolHours('20:00', '10:00'), 'overnight hours are not supported');
  assert(!isValidPoolHours('25:00', '26:00'), 'malformed hours are invalid');
});

Deno.test('today closes at the exact Madrid instant; future dates remain subject to other rules', () => {
  const date = '2026-10-15'; // Madrid is UTC+2.
  const evaluate = (instant: string) => evaluateBalinesePoolCutoff(date, '10:00', '19:00', new Date(instant));
  assert(evaluate('2026-10-15T16:59:59.999Z') === 'ALLOWED_BY_CUTOFF', '18:59:59.999 Madrid is before closing');
  assert(evaluate('2026-10-15T17:00:00.000Z') === 'CLOSED_TODAY', '19:00 Madrid is closed');
  assert(evaluate('2026-10-15T18:00:00.000Z') === 'CLOSED_TODAY', '20:00 Madrid is closed');
  assert(evaluateBalinesePoolCutoff('2026-10-16', '10:00', '19:00', new Date('2026-10-15T18:00:00Z')) === 'ALLOWED_BY_CUTOFF', 'tomorrow passes this gate only');
});

Deno.test('Madrid midnight changes today without using UTC date', () => {
  assert(evaluateBalinesePoolCutoff('2026-10-14', '10:00', '19:00', new Date('2026-10-14T21:59:00Z')) === 'CLOSED_TODAY', '23:59 Madrid is still the 14th');
  assert(evaluateBalinesePoolCutoff('2026-10-14', '10:00', '19:00', new Date('2026-10-14T22:01:00Z')) === 'PAST_DATE', '00:01 Madrid is the 15th');
  assert(evaluateBalinesePoolCutoff('2026-10-15', '10:00', '19:00', new Date('2026-10-14T22:01:00Z')) === 'ALLOWED_BY_CUTOFF', 'the new local day remains open before closing');
});

Deno.test('spring CET to CEST transition resolves a normal closing time and rejects a missing local time', () => {
  const date = '2026-03-29';
  assert(evaluateBalinesePoolCutoff(date, '01:00', '19:00', new Date('2026-03-29T16:59:59Z')) === 'ALLOWED_BY_CUTOFF', '18:59:59 CEST is open');
  assert(evaluateBalinesePoolCutoff(date, '01:00', '19:00', new Date('2026-03-29T17:00:00Z')) === 'CLOSED_TODAY', '19:00 CEST is closed');
  assert(evaluateBalinesePoolCutoff(date, '01:00', '02:30', new Date('2026-03-29T00:00:00Z')) === 'INVALID_SCHEDULE', 'nonexistent 02:30 cannot define a cutoff');
});

Deno.test('autumn CEST to CET transition never reopens after an ambiguous close', () => {
  const date = '2026-10-25';
  assert(evaluateBalinesePoolCutoff(date, '01:00', '19:00', new Date('2026-10-25T17:59:59Z')) === 'ALLOWED_BY_CUTOFF', '18:59:59 CET is open');
  assert(evaluateBalinesePoolCutoff(date, '01:00', '19:00', new Date('2026-10-25T18:00:00Z')) === 'CLOSED_TODAY', '19:00 CET is closed');
  assert(evaluateBalinesePoolCutoff(date, '01:00', '02:30', new Date('2026-10-25T00:00:00Z')) === 'INVALID_SCHEDULE', 'ambiguous close is rejected rather than reopening');
  assert(evaluateBalinesePoolCutoff(date, '01:00', '02:30', new Date('2026-10-25T01:15:00Z')) === 'INVALID_SCHEDULE', 'repeated hour is still rejected');
});

Deno.test('invalid dates and schedules fail closed', () => {
  assert(evaluateBalinesePoolCutoff('2026-02-30', '10:00', '19:00', new Date()) === 'INVALID_SCHEDULE', 'invalid calendar date');
  assert(evaluateBalinesePoolCutoff('2026-10-15', '19:00', '10:00', new Date('2026-10-15T12:00:00Z')) === 'INVALID_SCHEDULE', 'inverted hours');
  assert(evaluateBalinesePoolCutoff('2026-10-15', '10:00', '19:00', new Date('invalid')) === 'INVALID_SCHEDULE', 'invalid injected clock');
});
