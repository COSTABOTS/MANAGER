import { createPoolHoursApi, type PoolHoursSnapshot } from '../src/services/poolHoursApiContract.ts';
import {
  canSavePoolHours,
  initialPoolHoursRemoteState,
  loadedPoolHoursRemoteState,
  poolHoursConflictState,
  poolHoursErrorState,
  POOL_HOURS_REMOTE_ENABLED,
} from '../src/utils/poolHoursRemoteState.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const revision = '11111111-1111-4111-8111-111111111111';
const blank: PoolHoursSnapshot = {
  configured: false, opening_time: null, closing_time: null,
  time_zone: 'Europe/Madrid', revision: null,
};

Deno.test('Preview keeps the remote switch closed and never derives remote data from localStorage', () => {
  assert(POOL_HOURS_REMOTE_ENABLED === false, 'remote mode must need a reviewed code change');
  const state = initialPoolHoursRemoteState('restaurant-a');
  assert(state.status === 'loading' && state.openingTime === '' && state.closingTime === '' && state.revision === null, 'remote state starts blank');
  assert(!canSavePoolHours(state), 'no save before a successful server read');
});

Deno.test('remote get reads an unconfigured tenant without inventing hours', async () => {
  const requests: Record<string, unknown>[] = [];
  const api = createPoolHoursApi(async (body) => {
    requests.push(body);
    return { ok: true, action: 'poolHours.get', ...blank };
  });
  const snapshot = await api.get();
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
    return { ok: true, action: 'poolHours.save', configured: true, opening_time: '10:00',
      closing_time: '19:00', time_zone: 'Europe/Madrid', revision };
  });
  const snapshot = await api.save('10:00', '19:00', null);
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
    { ok: true, action: 'poolHours.get', configured: true, opening_time: '10:00', closing_time: '19:00', time_zone: 'UTC', revision },
    { ok: true, action: 'poolHours.get', configured: false, opening_time: '10:00', closing_time: null, time_zone: 'Europe/Madrid', revision: null },
    { ok: false, action: 'poolHours.get', code: 'POOL_HOURS_READ_FAILED' },
  ]) {
    let rejected = false;
    try { await createPoolHoursApi(async () => response).get(); } catch { rejected = true; }
    assert(rejected, 'invalid or failed remote response must be rejected');
  }
});
