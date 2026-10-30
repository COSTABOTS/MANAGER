// Full HTTP settings.save regression tests. Every external request is intercepted.
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalServe = Object.getOwnPropertyDescriptor(Deno, 'serve');
const envKeys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON'];
const originalEnv = new Map(envKeys.map((key) => [key, Deno.env.get(key)]));
let handler: ((request: Request) => Promise<Response>) | undefined;
const state = { store: 'supabase', mutations: [] as Array<{ path: string; tenant: string; method: string }>, oauthCalls: 0 };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

Object.defineProperty(Deno, 'serve', {
  configurable: true,
  value: (callback: (request: Request) => Promise<Response>) => {
    handler = callback;
    return { finished: Promise.resolve(), shutdown() {}, ref() {}, unref() {} };
  },
});
console.log = () => {};
Deno.env.set('SUPABASE_URL', 'https://edge-test.invalid');
Deno.env.set('SUPABASE_ANON_KEY', 'TEST_ANON');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'TEST_SERVICE_ROLE');

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === 'https://edge-test.invalid') {
    if (url.pathname === '/auth/v1/user') return json({ id: 'TEST_USER', aud: 'authenticated', role: 'authenticated' });
    if (url.pathname.endsWith('/PROFILES')) return json({ client_id: 'TENANT_A', role: 'ADMIN_CLIENTE', status: 'ACTIVE' });
    if (url.pathname.endsWith('/CLIENTES')) {
      return json({ client_id: 'TENANT_A', sheet_id: 'TEST_SHEET', reservation_store: state.store, status: 'ACTIVE' });
    }
    if (url.pathname.endsWith('/SETTINGS')) {
      if (request.method === 'GET') return json([{ CLAVE: 'BOOKING_INTERVAL', VALOR: '30' }]);
      state.mutations.push({ path: 'SETTINGS', tenant: url.searchParams.get('CLIENTE_ID') ?? '', method: request.method });
      if (request.method === 'PATCH') return json([{ id: 1 }]);
      if (request.method === 'POST') return json({ id: 2 });
    }
  }
  if (url.href === 'https://oauth2.googleapis.com/token') {
    state.oauthCalls++;
    return json({ access_token: 'TEST_GOOGLE_TOKEN' });
  }
  if (url.hostname === 'sheets.googleapis.com') {
    if (request.method === 'GET') return json({ values: [['VARIABLE', 'VALUE'], ['BOOKING_INTERVAL', '30']] });
    if (request.method === 'PUT') {
      state.mutations.push({ path: 'SHEETS_SETTINGS', tenant: 'TENANT_A', method: request.method });
      return json({ updatedRange: 'SETTINGS!A1:B2' });
    }
  }
  throw new Error(`UNMOCKED_NETWORK: ${url.origin}${url.pathname}`);
};

await import('./index.ts');

async function save(settings: unknown) {
  assert(handler, 'manager-api handler was not registered');
  const response = await handler(new Request('https://manager-api.invalid', {
    method: 'POST',
    headers: { Authorization: 'Bearer TEST_TOKEN', Origin: 'https://manager.costabots.com' },
    body: JSON.stringify({ action: 'settings.save', client_id: 'TENANT_B', settings }),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown>, cors: response.headers.get('Access-Control-Allow-Origin') };
}

Deno.test('settings.save blocks weekly activation before any Supabase or Sheets write', async () => {
  try {
    const payloads: unknown[] = [
      { WEEKLY_HOURS_ENABLED: 'true' },
      { weekly_hours_enabled: 'false' },
      [{ variable: 'WEEKLY_HOURS_ENABLED', value: 'true' }],
      { BOOKING_INTERVAL: '45', WEEKLY_HOURS_ENABLED: 'false' },
    ];
    for (const store of ['supabase', 'sheets']) {
      state.store = store;
      for (const settings of payloads) {
        state.mutations.length = 0;
        state.oauthCalls = 0;
        const result = await save(settings);
        assert(result.status === 403 && result.body.code === 'WEEKLY_HOURS_ACTIVATION_FORBIDDEN', `${store}: weekly key must be rejected`);
        assert(state.mutations.length === 0 && state.oauthCalls === 0, `${store}: rejection caused an external write or Sheets auth`);
        assert(result.cors === 'https://manager.costabots.com', `${store}: CORS changed`);
      }
    }

    // A normal setting still follows the existing tenant-scoped Supabase path.
    state.store = 'supabase';
    state.mutations.length = 0;
    const normal = await save({ BOOKING_INTERVAL: '45' });
    assert(normal.status === 200 && normal.body.ok === true, 'ordinary Supabase setting was blocked');
    assert(state.mutations.length === 1 && state.mutations[0].tenant === 'eq.TENANT_A', 'normal save did not use authenticated tenant');

    // Sheets retains its existing save path for an ordinary setting.
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----`;
    Deno.env.set('GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify({ client_email: 'test@example.invalid', private_key: pem }));
    state.store = 'sheets';
    state.mutations.length = 0;
    const sheetsNormal = await save({ BOOKING_INTERVAL: '45' });
    assert(sheetsNormal.status === 200 && sheetsNormal.body.ok === true, 'ordinary Sheets setting was blocked');
    assert(state.mutations.length === 1 && state.mutations[0].path === 'SHEETS_SETTINGS', 'Sheets normal save did not execute');
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalServe) Object.defineProperty(Deno, 'serve', originalServe);
    for (const [key, value] of originalEnv) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
});
