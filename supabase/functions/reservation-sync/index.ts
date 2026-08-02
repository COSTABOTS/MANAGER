import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  MAX_SYNC_ROWS,
  syncReservations,
  type ReservationSyncAdapter,
  type ReservationSyncInsert,
  type ReservationSyncRow,
  type ReservationSyncSummary,
  type ReservationSyncUpdate,
} from './syncReservations.ts';

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const RESERVATION_COLUMNS = 'id,client_id,legacy_reservation_id,public_reference,booking_date,booking_time,service,customer_name,customer_phone,pax,locale,special_request,status,legacy_status,source_channel,legacy_source,table_id,resource_id,room,arrived,feedback_sent,pre_dinner_sent,balinese_package,legacy_created_at,legacy_updated_at,legacy_locale,created_at';

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}

function stringValue(value: unknown) {
  return String(value ?? '').trim();
}

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function base64Url(value: Uint8Array) {
  let binary = '';
  value.forEach((item) => binary += String.fromCharCode(item));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemBuffer(pem: string) {
  const binary = atob(pem.replace(/\\n/g, '\n').replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, ''));
  return Uint8Array.from(binary, (item) => item.charCodeAt(0)).buffer;
}

async function googleReadToken() {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GOOGLE_SECRET_MISSING');
  const account = JSON.parse(raw) as { client_email?: string; private_key?: string };
  if (!account.client_email || !account.private_key) throw new Error('GOOGLE_SECRET_INVALID');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(bytes(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${base64Url(bytes(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })))}`;
  const cryptoKey = await crypto.subtle.importKey('pkcs8', pemBuffer(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, bytes(unsigned));
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}` }),
  });
  if (!response.ok) throw new Error('GOOGLE_AUTH_FAILED');
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error('GOOGLE_AUTH_FAILED');
  return payload.access_token;
}

async function readReservationsSheet(sheetId: string) {
  const token = await googleReadToken();
  const range = encodeURIComponent('RESERVAS!A:T');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('GOOGLE_SHEETS_READ_FAILED');
  return response.json() as Promise<{ values?: unknown[][] }>;
}

function createAdapter(db: SupabaseClient<any>): ReservationSyncAdapter {
  return {
    async beginRun(clientId) {
      const { data, error } = await db.from('reservation_sync_runs').insert({ client_id: clientId }).select('id').single();
      if (error?.code === '23505') throw new Error('SYNC_ALREADY_RUNNING');
      if (error || !data?.id) throw new Error('SYNC_RUN_START_FAILED');
      return String(data.id);
    },
    async finishRun(runId, summary) {
      const { error } = await db.from('reservation_sync_runs').update({
        finished_at: new Date().toISOString(),
        inserts: summary.inserts,
        updates: summary.updates,
        skips: summary.skips,
        errors: summary.errors,
        status: summary.status,
        error_summary: summary.error_summary,
      }).eq('id', runId).eq('status', 'running');
      if (error) throw new Error('SYNC_RUN_FINISH_FAILED');
    },
    async listExisting(clientId, legacyReservationIds) {
      if (legacyReservationIds.length === 0) return [];
      const { data, error } = await db.from('reservations').select(RESERVATION_COLUMNS)
        .eq('client_id', clientId).in('legacy_reservation_id', legacyReservationIds);
      if (error) throw new Error('SYNC_EXISTING_READ_FAILED');
      return (data ?? []) as ReservationSyncRow[];
    },
    async resolveTableIds(clientId, labels) {
      if (labels.length === 0) return new Map();
      const [byLabel, byLegacy] = await Promise.all([
        db.from('restaurant_tables').select('id,label,legacy_table_id').eq('client_id', clientId).in('label', labels),
        db.from('restaurant_tables').select('id,label,legacy_table_id').eq('client_id', clientId).in('legacy_table_id', labels),
      ]);
      if (byLabel.error || byLegacy.error) throw new Error('SYNC_TABLE_REFERENCE_READ_FAILED');
      const result = new Map<string, string>();
      [...(byLabel.data ?? []), ...(byLegacy.data ?? [])].forEach((row) => {
        if (row.label) result.set(String(row.label), String(row.id));
        if (row.legacy_table_id) result.set(String(row.legacy_table_id), String(row.id));
      });
      return result;
    },
    async resolveResourceIds(clientId, labels) {
      if (labels.length === 0) return new Map();
      const [byLabel, byLegacy] = await Promise.all([
        db.from('reservable_resources').select('id,label,legacy_resource_id').eq('client_id', clientId).in('label', labels),
        db.from('reservable_resources').select('id,label,legacy_resource_id').eq('client_id', clientId).in('legacy_resource_id', labels),
      ]);
      if (byLabel.error || byLegacy.error) throw new Error('SYNC_RESOURCE_REFERENCE_READ_FAILED');
      const result = new Map<string, string>();
      [...(byLabel.data ?? []), ...(byLegacy.data ?? [])].forEach((row) => {
        if (row.label) result.set(String(row.label), String(row.id));
        if (row.legacy_resource_id) result.set(String(row.legacy_resource_id), String(row.id));
      });
      return result;
    },
    async insertReservation(row: ReservationSyncInsert) {
      const { error } = await db.from('reservations').insert(row);
      if (error) throw new Error('SYNC_INSERT_FAILED');
    },
    async updateOwnedReservation(clientId, legacyReservationId, changes: ReservationSyncUpdate) {
      const { data, error } = await db.from('reservations').update(changes).eq('client_id', clientId)
        .eq('legacy_reservation_id', legacyReservationId).in('source_channel', ['sheets', 'legacy_unknown'])
        .select('id').maybeSingle();
      if (error) throw new Error('SYNC_UPDATE_FAILED');
      if (data) return 'updated';
      const { data: target, error: targetError } = await db.from('reservations').select('source_channel')
        .eq('client_id', clientId).eq('legacy_reservation_id', legacyReservationId).maybeSingle();
      if (targetError) throw new Error('SYNC_UPDATE_CHECK_FAILED');
      return target ? 'protected' : 'missing';
    },
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: 'SERVER_CONFIGURATION_MISSING' });

  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'UNAUTHENTICATED' });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json(400, { error: 'INVALID_JSON' });
  }
  const clientId = stringValue(body.client_id);
  if (!clientId || ['*', 'all', 'todos'].includes(clientId.toLowerCase())) return json(400, { error: 'CLIENT_ID_REQUIRED' });
  if ('sheet_id' in body || 'sheetId' in body) return json(400, { error: 'SHEET_ID_NOT_ALLOWED' });
  if (body.dry_run !== undefined && typeof body.dry_run !== 'boolean') return json(400, { error: 'INVALID_DRY_RUN' });
  const dryRun = body.dry_run !== false;
  const requestedLimit = body.max_rows === undefined ? 500 : Number(body.max_rows);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_SYNC_ROWS) return json(400, { error: 'INVALID_MAX_ROWS' });

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: 'INVALID_TOKEN' });
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await db.from('PROFILES').select('role,status')
    .eq('user_id', userData.user.id).eq('status', 'ACTIVE').maybeSingle();
  if (profileError || stringValue(profile?.role).toUpperCase() !== 'SUPER_ADMIN') return json(403, { error: 'ADMIN_REQUIRED' });

  const { data: tenant, error: tenantError } = await db.from('CLIENTES').select('client_id,sheet_id')
    .eq('client_id', clientId).maybeSingle();
  if (tenantError || !tenant) return json(404, { error: 'TENANT_NOT_FOUND' });
  const sheetId = stringValue(tenant.sheet_id);
  if (!sheetId) return json(409, { error: 'TENANT_SHEET_NOT_CONFIGURED' });

  try {
    const sheet = await readReservationsSheet(sheetId);
    const result: ReservationSyncSummary = await syncReservations({
      clientId,
      sheetValues: sheet.values,
      dryRun,
      maxRows: requestedLimit,
      adapter: createAdapter(db),
    });
    return json(200, result as unknown as Record<string, unknown>);
  } catch (error) {
    const code = error instanceof Error && ['SYNC_ALREADY_RUNNING', 'SYNC_ROW_LIMIT_EXCEEDED'].includes(error.message)
      ? error.message
      : 'RESERVATION_SYNC_FAILED';
    return json(code === 'SYNC_ALREADY_RUNNING' ? 409 : 500, { error: code });
  }
});
