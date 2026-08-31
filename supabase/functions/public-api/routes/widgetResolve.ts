import type { DbClient } from '../lib/clients.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { toStringValue } from '../lib/normalization.ts';

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export async function handleWidgetResolve(request: Request, dbClient: DbClient) {
  if (request.method !== 'GET') return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);

  const rawSlug = new URL(request.url).searchParams.get('slug') ?? '';
  const slug = toStringValue(rawSlug).toLowerCase();
  if (!slug || slug !== rawSlug.trim() || !SLUG_PATTERN.test(slug)) {
    return errorResponse(request, 'INVALID_REQUEST', 400);
  }

  const { data, error } = await dbClient
    .from('CLIENTES')
    .select('client_id,public_token,status,reservation_store,assistant_slug')
    .eq('assistant_slug', slug)
    .limit(2);

  if (error || !Array.isArray(data) || data.length !== 1) {
    return errorResponse(request, 'WIDGET_NOT_FOUND', 404);
  }

  const client = data[0] as Record<string, unknown>;
  const status = toStringValue(client.status).toUpperCase();
  const publicToken = toStringValue(client.public_token);
  if (status === 'SUSPENDED' || status === 'EXPIRED' || !publicToken) {
    return errorResponse(request, 'WIDGET_NOT_FOUND', 404);
  }

  return jsonResponse(request, {
    ok: true,
    client_id: toStringValue(client.client_id),
    public_token: publicToken,
  });
}
