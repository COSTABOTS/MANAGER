import type { ReservationRecord } from './types.ts';

export interface ReservationListShadowMetrics {
  match: boolean;
  sheets_count: number;
  supabase_count: number;
  matched_count: number;
  missing_in_supabase_count: number;
  extra_in_supabase_count: number;
  different_count: number;
}

export interface ReservationListShadowEvent {
  request_id: string;
  client_id: string;
  operation: 'manager_reservations_list';
  sheets_count: number;
  supabase_count: number;
  matched_count: number;
  missing_count: number;
  extra_count: number;
  different_count: number;
  match: boolean;
  shadow_status: 'ok' | 'mismatch' | 'error';
  latency_ms: number;
  error_code: 'SHADOW_TIMEOUT' | 'SHADOW_READ_FAILED' | null;
  created_at: string;
}

interface RunReservationListShadowOptions {
  enabled: boolean;
  requestId: string;
  clientId: string;
  sheetsReservations: ReservationRecord[];
  readSupabase: () => Promise<ReservationRecord[]>;
  timeoutMs?: number;
  log?: (event: ReservationListShadowEvent) => void;
}

const COMPARED_FIELDS: Array<keyof ReservationRecord> = [
  'date',
  'time',
  'pax',
  'status',
  'language',
  'origin',
  'table',
  'resource',
  'service',
  'arrived',
  'feedbackSent',
  'room',
  'balinesePackage',
];

function normalizeString(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim().toUpperCase();
}

function normalizeDate(value: unknown) {
  const raw = normalizeString(value);
  const legacy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return legacy
    ? `${legacy[3]}-${legacy[2].padStart(2, '0')}-${legacy[1].padStart(2, '0')}`
    : raw;
}

function normalizeTime(value: unknown) {
  const raw = normalizeString(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : raw;
}

function logicalIdentity(reservation: ReservationRecord) {
  return normalizeString(reservation.id);
}

function canonicalValue(field: keyof ReservationRecord, value: unknown) {
  if (field === 'date') return normalizeDate(value);
  if (field === 'time') return normalizeTime(value);
  if (field === 'pax') return Number(value) || 0;
  if (field === 'arrived' || field === 'feedbackSent') return value === true;
  return normalizeString(value);
}

function signature(reservation: ReservationRecord) {
  return JSON.stringify(COMPARED_FIELDS.map((field) => canonicalValue(field, reservation[field])));
}

function groupSignatures(reservations: ReservationRecord[]) {
  const groups = new Map<string, string[]>();
  for (const reservation of reservations) {
    const key = logicalIdentity(reservation);
    const values = groups.get(key) ?? [];
    values.push(signature(reservation));
    groups.set(key, values);
  }
  for (const values of groups.values()) values.sort();
  return groups;
}

export function compareReservationLists(
  sheetsReservations: ReservationRecord[],
  supabaseReservations: ReservationRecord[],
): ReservationListShadowMetrics {
  // Temporary pilot rule: the three source_channel=demo fixtures are technical
  // Supabase-only rows. Exclude only this source until those fixtures are removed.
  const comparableSupabase = supabaseReservations.filter(
    (reservation) => normalizeString(reservation.sourceChannel) !== 'DEMO',
  );
  const sheetsGroups = groupSignatures(sheetsReservations);
  const supabaseGroups = groupSignatures(comparableSupabase);
  const identities = new Set([...sheetsGroups.keys(), ...supabaseGroups.keys()]);
  let matched = 0;
  let missing = 0;
  let extra = 0;
  let different = 0;

  for (const identity of identities) {
    const sheets = [...(sheetsGroups.get(identity) ?? [])];
    const supabase = [...(supabaseGroups.get(identity) ?? [])];
    if (sheets.length === 0) {
      extra += supabase.length;
      continue;
    }
    if (supabase.length === 0) {
      missing += sheets.length;
      continue;
    }

    for (let index = sheets.length - 1; index >= 0; index -= 1) {
      const matchIndex = supabase.indexOf(sheets[index]);
      if (matchIndex >= 0) {
        matched += 1;
        sheets.splice(index, 1);
        supabase.splice(matchIndex, 1);
      }
    }
    const differingPairs = Math.min(sheets.length, supabase.length);
    different += differingPairs;
    missing += sheets.length - differingPairs;
    extra += supabase.length - differingPairs;
  }

  return {
    match: missing === 0 && extra === 0 && different === 0,
    sheets_count: sheetsReservations.length,
    supabase_count: comparableSupabase.length,
    matched_count: matched,
    missing_in_supabase_count: missing,
    extra_in_supabase_count: extra,
    different_count: different,
  };
}

function safeLog(log: (event: ReservationListShadowEvent) => void, event: ReservationListShadowEvent) {
  try {
    log(event);
  } catch {
    // Observability must never affect the official Sheets response.
  }
}

export async function runReservationListShadow(options: RunReservationListShadowOptions) {
  if (!options.enabled) return options.sheetsReservations;

  const startedAt = Date.now();
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 500, 1), 1_000);
  const log = options.log ?? ((event) => console.info(
    '[MANAGER_API][RESERVATIONS_LIST_SHADOW]',
    JSON.stringify(event),
  ));

  try {
    const supabaseReservations = await Promise.race([
      options.readSupabase(),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(Object.assign(new Error('SHADOW_TIMEOUT'), { code: 'SHADOW_TIMEOUT' })),
        timeoutMs,
      )),
    ]);
    const comparison = compareReservationLists(options.sheetsReservations, supabaseReservations);
    safeLog(log, {
      request_id: options.requestId,
      client_id: options.clientId,
      operation: 'manager_reservations_list',
      sheets_count: comparison.sheets_count,
      supabase_count: comparison.supabase_count,
      matched_count: comparison.matched_count,
      missing_count: comparison.missing_in_supabase_count,
      extra_count: comparison.extra_in_supabase_count,
      different_count: comparison.different_count,
      match: comparison.match,
      shadow_status: comparison.match ? 'ok' : 'mismatch',
      latency_ms: Date.now() - startedAt,
      error_code: null,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    const errorCode = (error as { code?: unknown }).code === 'SHADOW_TIMEOUT'
      ? 'SHADOW_TIMEOUT'
      : 'SHADOW_READ_FAILED';
    safeLog(log, {
      request_id: options.requestId,
      client_id: options.clientId,
      operation: 'manager_reservations_list',
      sheets_count: options.sheetsReservations.length,
      supabase_count: 0,
      matched_count: 0,
      missing_count: 0,
      extra_count: 0,
      different_count: 0,
      match: false,
      shadow_status: 'error',
      latency_ms: Date.now() - startedAt,
      error_code: errorCode,
      created_at: new Date().toISOString(),
    });
  }

  return options.sheetsReservations;
}
