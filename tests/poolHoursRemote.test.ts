import { createPoolHoursApi, type PoolHoursSnapshot } from '../src/services/poolHoursApiContract.ts';
import {
  canSavePoolHours,
  initialPoolHoursRemoteState,
  loadedPoolHoursRemoteState,
  poolHoursConflictState,
  poolHoursErrorState,
} from '../src/utils/poolHoursRemoteState.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const revision = '11111111-1111-4111-8111-111111111111';
const blank: PoolHoursSnapshot = {
  configured: false, opening_time: null, closing_time: null,
  time_zone: 'Europe/Madrid', revision: null,
};

Deno.test('remote pool state starts blank and cannot save before a server read', () => {
  const state = initialPoolHoursRemoteState('restaurant-a');
  assert(state.status === 'loading' && state.openingTime === '' && state.closingTime === '' && state.revision === null, 'remote state starts blank');
  assert(!canSavePoolHours(state), 'no save before a successful server read');
});

Deno.test('remote get reads an unconfigured tenant without inventing hours', async () => {
  const requests: Record<string, unknown>[] = [];
  const api = createPoolHoursApi(async (body) => {
    requests.push(body);
    return { ok: true, action: 'poolHours.get', client_id: 'restaurant-a', ...blank };
  }, () => 'restaurant-a');
  const snapshot = await api.get('restaurant-a');
  const state = loadedPoolHoursRemoteState('restaurant-a', snapshot);
  assert(requests.length === 1 && requests[0].action === 'poolHours.get', 'get invokes the Manager action');
  assert(!('client_id' in requests[0]), 'frontend does not select a tenant for the RPC');
  assert(state.status === 'unconfigured' && !state.openingTime && !state.closingTime, 'unconfigured remains blank');
  assert(!canSavePoolHours(state), 'blank hours cannot be saved');
});

Deno.test('remote save sends the loaded revision and accepts the returned revision', async () => {
  const requests: Record<string, unknown>[] = [];
  const api = createPoolHoursApi(async (body) => {
    requests.push(body);
    return { ok: true, action: 'poolHours.save', client_id: 'restaurant-a', configured: true, opening_time: '10:00',
      closing_time: '19:00', time_zone: 'Europe/Madrid', revision };
  }, () => 'restaurant-a');
  const snapshot = await api.save('restaurant-a', '10:00', '19:00', null);
  assert(requests.length === 1 && requests[0].expected_revision === null, 'first save uses null revision');
  assert(requests[0].opening_time === '10:00' && !('client_id' in requests[0]), 'payload contains hours but no tenant id');
  const state = loadedPoolHoursRemoteState('restaurant-a', snapshot);
  assert(state.revision === revision && canSavePoolHours(state), 'returned CAS revision is retained');
});

Deno.test('conflict and read errors preserve the draft while blocking another write', () => {
  const loaded = loadedPoolHoursRemoteState('restaurant-a', {
    configured: true, opening_time: '10:00', closing_time: '19:00', time_zone: 'Europe/Madrid', revision,
  });
  const edited = { ...loaded, openingTime: '11:00' };
  const conflict = poolHoursConflictState(edited);
  const failed = poolHoursErrorState(edited);
  assert(conflict.openingTime === '11:00' && conflict.revision === revision && !canSavePoolHours(conflict), 'conflict preserves unsaved edits but blocks retry');
  assert(failed.openingTime === '11:00' && !canSavePoolHours(failed), 'unknown failure also blocks retry');
});

Deno.test('malformed or failed server responses cannot become a successful configuration', async () => {
  for (const response of [
    { ok: true, action: 'poolHours.get', client_id: 'restaurant-a', configured: true, opening_time: '10:00', closing_time: '19:00', time_zone: 'UTC', revision },
    { ok: true, action: 'poolHours.get', client_id: 'restaurant-a', configured: false, opening_time: '10:00', closing_time: null, time_zone: 'Europe/Madrid', revision: null },
    { ok: true, action: 'poolHours.get', client_id: 'restaurant-b', ...blank },
    { ok: false, action: 'poolHours.get', code: 'POOL_HOURS_READ_FAILED' },
  ]) {
    let rejected = false;
    try { await createPoolHoursApi(async () => response, () => 'restaurant-a').get('restaurant-a'); } catch { rejected = true; }
    assert(rejected, 'invalid or failed remote response must be rejected');
  }
});

Deno.test('pool-hours client refuses a tenant switch before either API action', async () => {
  let calls = 0;
  const api = createPoolHoursApi(async () => { calls += 1; return {}; }, () => 'restaurant-b');
  for (const action of [() => api.get('restaurant-a'), () => api.save('restaurant-a', '10:00', '19:00', null)]) {
    let rejected = false;
    try { await action(); } catch { rejected = true; }
    assert(rejected, 'stale tenant must be rejected');
  }
  assert(calls === 0, 'tenant mismatch must not invoke manager-api');
});
