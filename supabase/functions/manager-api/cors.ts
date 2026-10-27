// Explicit browser origins only. Keep the deployed v129 Preview origin during migration.
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://manager.costabots.com',
  'https://manager-4u8ir2cd5-costabots-projects.vercel.app',
  'https://manager-preview.costabots.com',
]);

export function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://manager.costabots.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
