import type { DbClient } from '../lib/clients.ts';
import { errorResponse, jsonResponse } from '../lib/responses.ts';
import { toStringValue } from '../lib/normalization.ts';

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const SLUG_FIELDS = {
  assistant: 'assistant_slug',
  booking: 'booking_slug',
} as const;

export type WidgetResolveType = keyof typeof SLUG_FIELDS;

export function resolveSlugField(type: string | null): typeof SLUG_FIELDS[WidgetResolveType] | null {
  if (type === null) return SLUG_FIELDS.assistant;
  return type in SLUG_FIELDS ? SLUG_FIELDS[type as WidgetResolveType] : null;
}

export function isWidgetResolveClientUsable(client: Record<string, unknown>) {
  const status = toStringValue(client.status).toUpperCase();
  return status !== 'SUSPENDED' && status !== 'EXPIRED' && Boolean(toStringValue(client.public_token));
}

export function hasExactlyOneWidgetResolveResult(data: unknown): data is Record<string, unknown>[] {
  return Array.isArray(data) && data.length === 1;
}

export async function handleWidgetResolve(request: Request, dbClient: DbClient) {
  if (request.method !== 'GET') return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);

  const rawSlug = new URL(request.url).searchParams.get('slug') ?? '';
  const slugField = resolveSlugField(new URL(request.url).searchParams.get('type'));
  if (!slugField) return errorResponse(request, 'INVALID_REQUEST', 400);
  const slug = toStringValue(rawSlug).toLowerCase();
  if (!slug || slug !== rawSlug.trim() || !SLUG_PATTERN.test(slug)) {
    return errorResponse(request, 'INVALID_REQUEST', 400);
  }

  const { data, error } = await dbClient
    .from('CLIENTES')
    .select(`client_id,public_token,status,reservation_store,${slugField}`)
    .eq(slugField, slug)
    .limit(2);

  if (error || !hasExactlyOneWidgetResolveResult(data)) {
    return errorResponse(request, 'WIDGET_NOT_FOUND', 404);
  }

  const client = data[0] as Record<string, unknown>;
  const publicToken = toStringValue(client.public_token);
  if (!isWidgetResolveClientUsable(client)) {
    return errorResponse(request, 'WIDGET_NOT_FOUND', 404);
  }

  return jsonResponse(request, {
    ok: true,
    client_id: toStringValue(client.client_id),
    public_token: publicToken,
  });
}
