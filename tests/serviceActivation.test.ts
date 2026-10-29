import { changeEnabledService, createServiceActivationClient, parseEnabledServices } from '../src/services/serviceActivationContract.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(run: () => Promise<unknown>, code: string) {
  try { await run(); } catch (error) {
    assert(error instanceof Error && error.message === code, `expected ${code}, received ${String(error)}`);
    return;
  }
  throw new Error(`expected ${code}`);
}

Deno.test('explicitly empty services stay empty; only an absent legacy key defaults to CENA', () => {
  assert(parseEnabledServices({}).join() === 'CENA', 'absent legacy setting');
  assert(parseEnabledServices({ SERVICES_ENABLED: '' }).length === 0, 'explicit empty setting');
  assert(parseEnabledServices({ SERVICES_ENABLED: 'ALMUERZO,BALINESA' }).join() === 'ALMUERZO,BALINESA', 'valid services');
  try { parseEnabledServices({ SERVICES_ENABLED: 'UNKNOWN' }); throw new Error('accepted unknown service'); }
  catch (error) { assert(error instanceof Error && error.message === 'SERVICES_READ_INVALID', 'unknown service rejected'); }
});

Deno.test('last service cannot be disabled while widget/config falls back to CENA', () => {
  assert(changeEnabledService(['CENA', 'BALINESA'], 'BALINESA', false).join() === 'CENA', 'independent service');
  try { changeEnabledService(['BALINESA'], 'BALINESA', false); throw new Error('accepted empty service set'); }
  catch (error) { assert(error instanceof Error && error.message === 'LAST_SERVICE_UNSAFE', 'last service blocked'); }
});

Deno.test('activation writes only SERVICES_ENABLED for the authenticated tenant and confirms readback', async () => {
  let stored = 'CENA,BALINESA';
  const requests: Record<string, unknown>[] = [];
  const save = createServiceActivationClient(async (body) => {
    requests.push(body);
    if (body.action === 'settings.save') stored = String((body.settings as Record<string, unknown>).SERVICES_ENABLED);
    return { ok: true, client_id: 'restaurant-a', settings: { SERVICES_ENABLED: stored } };
  }, () => 'restaurant-a');
  const next = await save('restaurant-a', ['CENA', 'BALINESA'], 'ALMUERZO', true);
  assert(next.join() === 'CENA,BALINESA,ALMUERZO', 'new service returned');
  assert(requests.map((body) => body.action).join() === 'settings.get,settings.save,settings.get', 'read/save/verify order');
  assert(JSON.stringify(requests[1]) === JSON.stringify({ action: 'settings.save', settings: { SERVICES_ENABLED: stored } }), 'only one setting written');
  assert(requests.every((body) => !('client_id' in body)), 'no browser tenant override in action payload');
});

Deno.test('stale state, tenant mismatch and failed save never report success', async () => {
  let writes = 0;
  const invoke = async (body: Record<string, unknown>) => {
    if (body.action === 'settings.save') writes++;
    return { ok: true, client_id: 'restaurant-a', settings: { SERVICES_ENABLED: 'CENA' } };
  };
  const save = createServiceActivationClient(invoke, () => 'restaurant-a');
  await rejects(() => save('restaurant-b', ['CENA'], 'ALMUERZO', true), 'TENANT_CHANGED');
  await rejects(() => save('restaurant-a', ['ALMUERZO'], 'CENA', true), 'SERVICES_CONFLICT');
  await rejects(() => save('restaurant-a', ['CENA'], 'CENA', false), 'LAST_SERVICE_UNSAFE');
  assert(writes === 0, 'no writes on rejected requests');
  await rejects(() => save('restaurant-a', ['CENA'], 'ALMUERZO', true), 'SERVICE_SAVE_UNCONFIRMED');
  assert(Number(writes) === 1, 'one attempted write must be confirmed by readback');
});
