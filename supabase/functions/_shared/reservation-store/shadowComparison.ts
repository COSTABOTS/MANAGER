import type { AvailabilityResult } from './types.ts';

// Pilot operational note: exclude 2026-08-16 while the three synthetic Demo
// fixtures remain in Supabase, because two active fixtures affect availability.

export interface AvailabilityShadowComparison {
  match: boolean;
  sheets_count: number;
  supabase_count: number;
  requested_time_match: boolean;
  missing_in_supabase_count: number;
  extra_in_supabase_count: number;
}
export interface AvailabilityShadowEvent {
  request_id: string;
  client_id: string;
  operation: 'availability_by_hour';
  match: boolean;
  sheets_count: number;
  supabase_count: number;
  requested_time_match: boolean;
  missing_count: number;
  extra_count: number;
  shadow_status: 'ok' | 'mismatch' | 'error';
  latency_ms: number;
  error_code: 'SHADOW_TIMEOUT' | 'SHADOW_READ_FAILED' | null;
  created_at: string;
}

export interface AvailabilityShadowOptions {
  enabled: boolean;
  requestId: string;
  clientId: string;
  sheetsResult: AvailabilityResult;
  readSupabase: () => Promise<AvailabilityResult>;
  timeoutMs?: number;
  now?: () => number;
  log?: (event: AvailabilityShadowEvent) => void;
}

function normalizeTime(value: unknown) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : raw;
}

function normalizedTimes(values: string[]) {
  return [...new Set(values.map(normalizeTime).filter(Boolean))].sort();
}

export function compareAvailabilityResults(
  sheets: AvailabilityResult,
  supabase: AvailabilityResult,
): AvailabilityShadowComparison {
  const sheetsTimes = normalizedTimes(sheets.availableTimes);
  const supabaseTimes = normalizedTimes(supabase.availableTimes);
  const sheetsSet = new Set(sheetsTimes);
  const supabaseSet = new Set(supabaseTimes);
  const missing = sheetsTimes.filter((time) => !supabaseSet.has(time)).length;
  const extra = supabaseTimes.filter((time) => !sheetsSet.has(time)).length;
  const requestedTimeMatch = sheets.requestedTimeAvailable === supabase.requestedTimeAvailable;

  return {
    match: sheets.requestedPax === supabase.requestedPax
      && requestedTimeMatch
      && missing === 0
      && extra === 0,
    sheets_count: sheetsTimes.length,
    supabase_count: supabaseTimes.length,
    requested_time_match: requestedTimeMatch,
    missing_in_supabase_count: missing,
    extra_in_supabase_count: extra,
  };
}

function timeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: number | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error('SHADOW_TIMEOUT')), timeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeoutId));
}

export async function runAvailabilityShadow(options: AvailabilityShadowOptions): Promise<void> {
  if (!options.enabled) return;

  const now = options.now ?? Date.now;
  const startedAt = now();
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 350, 1), 1000);
  const log = options.log ?? ((event) => console.info('[PUBLIC_API][AVAILABILITY_SHADOW]', JSON.stringify(event)));
  const emit = (event: AvailabilityShadowEvent) => {
    try { log(event); } catch { /* Observability must never affect the official response. */ }
  };

  try {
    const supabaseResult = await timeout(options.readSupabase(), timeoutMs);
    const comparison = compareAvailabilityResults(options.sheetsResult, supabaseResult);
    emit({
      request_id: options.requestId,
      client_id: options.clientId,
      operation: 'availability_by_hour',
      match: comparison.match,
      sheets_count: comparison.sheets_count,
      supabase_count: comparison.supabase_count,
      requested_time_match: comparison.requested_time_match,
      missing_count: comparison.missing_in_supabase_count,
      extra_count: comparison.extra_in_supabase_count,
      shadow_status: comparison.match ? 'ok' : 'mismatch',
      latency_ms: Math.max(0, now() - startedAt),
      error_code: null,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    emit({
      request_id: options.requestId,
      client_id: options.clientId,
      operation: 'availability_by_hour',
      match: false,
      sheets_count: normalizedTimes(options.sheetsResult.availableTimes).length,
      supabase_count: 0,
      requested_time_match: false,
      missing_count: 0,
      extra_count: 0,
      shadow_status: 'error',
      latency_ms: Math.max(0, now() - startedAt),
      error_code: error instanceof Error && error.message === 'SHADOW_TIMEOUT'
        ? 'SHADOW_TIMEOUT'
        : 'SHADOW_READ_FAILED',
      created_at: new Date().toISOString(),
    });
  }
}
