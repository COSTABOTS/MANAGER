import { getCorsHeaders } from './cors.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const allowed = [
  'https://manager.costabots.com',
  'https://manager-4u8ir2cd5-costabots-projects.vercel.app',
  'https://manager-preview.costabots.com',
];

for (const method of ['OPTIONS', 'POST']) {
  for (const origin of allowed) {
    Deno.test(`${method} allows exact origin ${origin}`, () => {
      const request = new Request('https://example.invalid', { method, headers: { Origin: origin } });
      const headers = getCorsHeaders(request);
      assert(headers['Access-Control-Allow-Origin'] === origin, 'allowed origin must be echoed');
      assert(headers['Access-Control-Allow-Methods'] === 'POST, OPTIONS', 'methods must remain unchanged');
    });
  }

  Deno.test(`${method} rejects unknown origin`, () => {
    const request = new Request('https://example.invalid', { method, headers: { Origin: 'https://manager-unknown.vercel.app' } });
    assert(getCorsHeaders(request)['Access-Control-Allow-Origin'] !== 'https://manager-unknown.vercel.app', 'unknown origin must not be echoed');
  });
}

Deno.test('POST success and error responses retain CORS headers', () => {
  const request = new Request('https://example.invalid', { method: 'POST', headers: { Origin: allowed[2] } });
  for (const status of [200, 400, 500]) {
    const response = new Response('{}', { status, headers: getCorsHeaders(request) });
    assert(response.headers.get('Access-Control-Allow-Origin') === allowed[2], `CORS missing for status ${status}`);
  }
});
