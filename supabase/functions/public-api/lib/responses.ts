const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://manager.costabots.com',
  'https://typebot.io',
  'https://app.typebot.io',
  'https://viewer.typebot.io',
]);

export function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';

  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

export function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      'Content-Type': 'application/json',
    },
  });
}

export function errorResponse(request: Request, error: string, status = 200, context: Record<string, unknown> = {}) {
  return jsonResponse(request, {
    ok: false,
    code: error,
    error,
    message: error,
    ...(Object.keys(context).length ? { context } : {}),
  }, status);
}
