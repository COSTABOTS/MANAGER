import { createWeeklyHoursApi } from '../src/services/weeklyHoursApiContract.ts';
import { createWeeklyHoursDraft, toWeeklyHoursRows } from '../src/utils/weeklyHoursDraft.ts';
import { canUseRemoteHoursPreview, REMOTE_HOURS_PREVIEW_ENABLED } from '../src/utils/remoteHoursPreview.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const preview = {
  origin: 'https://manager-preview.costabots.com',
  environment: 'preview',
  branch: 'feature/weekly-hours-availability',
};
const revision = 'a'.repeat(64);
const rules = toWeeklyHoursRows(createWeeklyHoursDraft());

Deno.test('remote editors require a verified tenant on authorized Preview or production Manager', () => {
  assert(REMOTE_HOURS_PREVIEW_ENABLED === true, 'the reviewed Preview gate must be enabled');
  assert(canUseRemoteHoursPreview(preview, 'A', true, false), 'authorized Preview may use remote hours');
  const production = { origin: 'https://manager.costabots.com', environment: 'production', branch: 'main' };
  assert(canUseRemoteHoursPreview(production, 'A', true, false), 'exact production Manager may edit hours');
  assert(!canUseRemoteHoursPreview({ ...preview, environment: 'production' }, 'A', true, false), 'Preview origin cannot claim production');
  assert(!canUseRemoteHoursPreview({ ...preview, origin: 'https://manager.costabots.com' }, 'A', true, false), 'Preview build cannot claim production');
  assert(!canUseRemoteHoursPreview({ ...preview, branch: 'main' }, 'A', true, false), 'main branch cannot claim Preview');
  assert(!canUseRemoteHoursPreview(production, 'A', false, false), 'production requires verified Settings');
  assert(!canUseRemoteHoursPreview(production, 'A', true, true), 'production demo remains closed');
  assert(!canUseRemoteHoursPreview(preview, '', true, false), 'missing tenant must fail closed');
  assert(!canUseRemoteHoursPreview(preview, 'A', false, false), 'unverified Settings must fail closed');
  assert(!canUseRemoteHoursPreview(preview, 'A', true, true), 'demo mode must fail closed');
});

Deno.test('weekly client requires the active tenant and echoes the resolved tenant', async () => {
  const requests: Record<string, unknown>[] = [];
  const api = createWeeklyHoursApi(async (body) => {
    requests.push(body);
    return { ok: true, action: body.action, client_id: 'A', rules, revision };
  }, () => 'A');
  const loaded = await api.get('A');
  const saved = await api.save('A', rules, revision);
  assert(loaded.client_id === 'A' && saved.revision === revision, 'read and save retain verified identity and revision');
  assert(requests.length === 2 && !('client_id' in requests[0]) && !('client_id' in requests[1]), 'API contract does not trust a browser tenant id');
  assert(requests[1].expected_revision === revision, 'save forwards the loaded CAS revision');
});

Deno.test('weekly client blocks a changed tenant before reads or writes', async () => {
  let calls = 0;
  const api = createWeeklyHoursApi(async () => { calls += 1; return {}; }, () => 'B');
  for (const action of [() => api.get('A'), () => api.save('A', rules, revision)]) {
    let rejected = false;
    try { await action(); } catch { rejected = true; }
    assert(rejected, 'stale tenant must be rejected');
  }
  assert(calls === 0, 'no request reaches manager-api for a stale tenant');
});

Deno.test('weekly client rejects mismatched or malformed server responses', async () => {
  for (const response of [
    { ok: true, action: 'weeklyHours.get', client_id: 'B', rules, revision },
    { ok: true, action: 'weeklyHours.get', client_id: 'A', rules, revision: 'invalid' },
    { ok: false, action: 'weeklyHours.get', code: 'WEEKLY_HOURS_READ_FAILED' },
  ]) {
    let rejected = false;
    try { await createWeeklyHoursApi(async () => response, () => 'A').get('A'); } catch { rejected = true; }
    assert(rejected, 'unverified response must never enable editing');
  }
});
