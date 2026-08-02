import {
  normalizeSheetReservations,
  type NormalizedSheetReservation,
  type SyncIssue,
} from './normalizeSheetReservation.ts';

export const MAX_SYNC_ROWS = 500;
const OWNED_SOURCE_CHANNELS = new Set(['sheets', 'legacy_unknown']);

export interface AdministrativeAuthAdapter {
  serviceRoleCanReadRuns(token: string): Promise<boolean>;
  getAuthenticatedUserId(token: string): Promise<string | null>;
  isActiveSuperAdmin(userId: string): Promise<boolean>;
}

export async function authorizeAdministrativeToken(
  token: string,
  adapter: AdministrativeAuthAdapter,
): Promise<'service_role' | 'super_admin'> {
  if (!token.trim()) throw new Error('UNAUTHENTICATED');
  if (await adapter.serviceRoleCanReadRuns(token)) return 'service_role';
  const userId = await adapter.getAuthenticatedUserId(token);
  if (!userId) throw new Error('INVALID_TOKEN');
  if (!await adapter.isActiveSuperAdmin(userId)) throw new Error('ADMIN_REQUIRED');
  return 'super_admin';
}

export async function authorizeAdministrativeRequest(
  request: Request,
  adapter: AdministrativeAuthAdapter,
): Promise<Response | null> {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  try {
    await authorizeAdministrativeToken(token, adapter);
    return null;
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_TOKEN';
    const status = code === 'UNAUTHENTICATED' || code === 'INVALID_TOKEN' ? 401 : 403;
    const safeCode = status === 403 ? 'ADMIN_REQUIRED' : code;
    return new Response(JSON.stringify({ error: safeCode }), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

export interface ReservationSyncRow {
  id?: string;
  client_id: string;
  legacy_reservation_id: string;
  public_reference?: string | null;
  booking_date: string;
  booking_time: string | null;
  service: string;
  customer_name: string | null;
  customer_phone: string | null;
  pax: number;
  locale: string | null;
  special_request: string | null;
  status: string;
  legacy_status: string | null;
  source_channel: string;
  legacy_source: string | null;
  table_id: string | null;
  resource_id: string | null;
  room: string | null;
  arrived: boolean;
  feedback_sent: boolean;
  pre_dinner_sent: boolean;
  balinese_package: string | null;
  legacy_created_at: string | null;
  legacy_updated_at: string | null;
  legacy_locale: string | null;
  created_at?: string;
}

export type ReservationSyncInsert = ReservationSyncRow & { public_reference: string };
export type ReservationSyncUpdate = Omit<
  ReservationSyncRow,
  'id' | 'client_id' | 'legacy_reservation_id' | 'public_reference' | 'source_channel' | 'created_at'
>;

export type AtomicReservationPlanRow = ReservationSyncUpdate & {
  legacy_reservation_id: string;
};

export interface AtomicReservationSyncResult {
  run_id: string;
  status: 'completed' | 'failed';
  inserted: number;
  updated: number;
  skipped: number;
  deleted: 0;
  errors: number;
  error_code?: string;
  idempotent_replay: boolean;
}

export interface ReservationSyncSummary {
  run_id: string | null;
  tenant: string;
  dry_run: boolean;
  rows_read: number;
  rows_importable: number;
  rows_excluded: number;
  rows_with_warnings: number;
  rows_blocked: number;
  status: 'completed' | 'partial' | 'failed';
  inserts: number;
  updates: number;
  deletes: 0;
  skips: number;
  would_insert: number;
  would_update: number;
  would_skip: number;
  errors: number;
  warnings: number;
  blocking_errors: number;
  excluded_by_code: Record<string, number>;
  error_summary: SyncIssue[];
  idempotent_replay: boolean;
}

export interface ReservationSyncAdapter {
  listExisting(clientId: string, legacyReservationIds: string[]): Promise<ReservationSyncRow[]>;
  resolveTableIds(clientId: string, labels: string[]): Promise<Map<string, string>>;
  resolveResourceIds(clientId: string, labels: string[]): Promise<Map<string, string>>;
  applyAtomicPlan(clientId: string, requestId: string, rows: AtomicReservationPlanRow[]): Promise<AtomicReservationSyncResult>;
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function comparable(row: ReservationSyncRow | ReservationSyncUpdate) {
  return {
    booking_date: row.booking_date,
    booking_time: row.booking_time,
    service: row.service,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    pax: row.pax,
    locale: row.locale,
    special_request: row.special_request,
    status: row.status,
    legacy_status: row.legacy_status,
    legacy_source: row.legacy_source,
    table_id: row.table_id,
    resource_id: row.resource_id,
    room: row.room,
    arrived: row.arrived,
    feedback_sent: row.feedback_sent,
    pre_dinner_sent: row.pre_dinner_sent,
    balinese_package: row.balinese_package,
    legacy_created_at: row.legacy_created_at,
    legacy_updated_at: row.legacy_updated_at,
    legacy_locale: row.legacy_locale,
  };
}

function asUpdate(
  row: NormalizedSheetReservation,
  tableId: string | null,
  resourceId: string | null,
): ReservationSyncUpdate {
  return {
    booking_date: row.bookingDate,
    booking_time: row.bookingTime,
    service: row.service,
    customer_name: row.customerName,
    customer_phone: row.customerPhone,
    pax: row.pax,
    locale: row.locale,
    special_request: row.specialRequest,
    status: row.status,
    legacy_status: row.legacyStatus,
    legacy_source: row.legacySource,
    table_id: tableId,
    resource_id: resourceId,
    room: row.room,
    arrived: row.arrived,
    feedback_sent: row.feedbackSent,
    pre_dinner_sent: row.preDinnerSent,
    balinese_package: row.balinesePackage,
    legacy_created_at: row.legacyCreatedAt,
    legacy_updated_at: row.legacyUpdatedAt,
    legacy_locale: row.legacyLocale,
  };
}

function issue(rowNumber: number, code: string, severity: SyncIssue['severity'], field?: string): SyncIssue {
  return { row_number: rowNumber, code, severity, ...(field ? { field } : {}) };
}

type PlannedAction =
  | { kind: 'insert'; rowNumber: number; planRow: AtomicReservationPlanRow }
  | { kind: 'update'; rowNumber: number; planRow: AtomicReservationPlanRow }
  | { kind: 'skip'; rowNumber: number; planRow: AtomicReservationPlanRow };

function canonicalPlan(clientId: string, rows: AtomicReservationPlanRow[]) {
  return JSON.stringify({ client_id: clientId, rows });
}

export async function reservationSyncRequestId(clientId: string, rows: AtomicReservationPlanRow[]) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPlan(clientId, rows))));
  const hex = [...digest.slice(0, 16)].map((value) => value.toString(16).padStart(2, '0')).join('').split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function refreshIssueCounters(summary: ReservationSyncSummary, issues: SyncIssue[], actions: PlannedAction[]) {
  const excluded = issues.filter((item) => item.severity === 'excluded_row');
  const warnings = issues.filter((item) => item.severity === 'warning');
  const blocking = issues.filter((item) => item.severity === 'blocking_error');
  const actionRows = new Set(actions.map((item) => item.rowNumber));
  summary.rows_importable = actionRows.size;
  summary.rows_excluded = new Set(excluded.map((item) => item.row_number)).size;
  summary.rows_blocked = new Set(blocking.map((item) => item.row_number)).size;
  summary.rows_with_warnings = new Set(warnings.map((item) => item.row_number).filter((row) => actionRows.has(row))).size;
  summary.warnings = warnings.length;
  summary.blocking_errors = blocking.length;
  summary.errors = summary.blocking_errors;
  summary.excluded_by_code = excluded.reduce<Record<string, number>>((counts, item) => {
    counts[item.code] = (counts[item.code] ?? 0) + 1;
    return counts;
  }, {});
  summary.error_summary = issues;
}

export async function syncReservations(input: {
  clientId: string;
  sheetValues: unknown[][] | undefined;
  dryRun?: boolean;
  maxRows?: number;
  adapter: ReservationSyncAdapter;
}): Promise<ReservationSyncSummary> {
  const dryRun = input.dryRun !== false;
  const maxRows = Math.min(Math.max(input.maxRows ?? 500, 1), MAX_SYNC_ROWS);
  const sourceRowCount = Math.max(0, (input.sheetValues?.length ?? 0) - 1);
  if (sourceRowCount > maxRows) throw new Error('SYNC_ROW_LIMIT_EXCEEDED');

  const normalized = normalizeSheetReservations(input.sheetValues);
  const issues = [...normalized.issues];
  const summary: ReservationSyncSummary = {
    run_id: null,
    tenant: input.clientId,
    dry_run: dryRun,
    rows_read: sourceRowCount,
    rows_importable: 0,
    rows_excluded: 0,
    rows_with_warnings: 0,
    rows_blocked: 0,
    status: 'completed',
    inserts: 0,
    updates: 0,
    deletes: 0,
    skips: 0,
    would_insert: 0,
    would_update: 0,
    would_skip: 0,
    errors: 0,
    warnings: 0,
    blocking_errors: 0,
    excluded_by_code: {},
    error_summary: issues,
    idempotent_replay: false,
  };

  try {
    const [existingRows, tableIds, resourceIds] = await Promise.all([
      input.adapter.listExisting(input.clientId, normalized.rows.map((row) => row.legacyReservationId)),
      input.adapter.resolveTableIds(input.clientId, unique(normalized.rows.map((row) => row.tableLabel))),
      input.adapter.resolveResourceIds(input.clientId, unique(normalized.rows.map((row) => row.resourceLabel))),
    ]);
    const existingById = new Map(existingRows.map((row) => [row.legacy_reservation_id, row]));
    const actions: PlannedAction[] = [];

    for (const row of normalized.rows) {
      const tableId = row.tableLabel ? tableIds.get(row.tableLabel) ?? null : null;
      const resourceId = row.resourceLabel ? resourceIds.get(row.resourceLabel) ?? null : null;
      if (row.tableLabel && !tableId) issues.push(issue(row.rowNumber, 'TABLE_REFERENCE_NOT_FOUND', 'warning', 'table_id'));
      if (row.resourceLabel && !resourceId) issues.push(issue(row.rowNumber, 'RESOURCE_REFERENCE_NOT_FOUND', 'warning', 'resource_id'));

      const changes = asUpdate(row, tableId, resourceId);
      const planRow: AtomicReservationPlanRow = { legacy_reservation_id: row.legacyReservationId, ...changes };
      const existing = existingById.get(row.legacyReservationId);
      if (!existing) {
        summary.would_insert += 1;
        actions.push({ kind: 'insert', rowNumber: row.rowNumber, planRow });
        continue;
      }

      if (!OWNED_SOURCE_CHANNELS.has(existing.source_channel)) {
        issues.push(issue(row.rowNumber, 'PROTECTED_SOURCE_CHANNEL', 'blocking_error', 'source_channel'));
        continue;
      }
      if (JSON.stringify(comparable(existing)) === JSON.stringify(comparable(changes))) {
        summary.would_skip += 1;
        actions.push({ kind: 'skip', rowNumber: row.rowNumber, planRow });
        continue;
      }

      summary.would_update += 1;
      actions.push({ kind: 'update', rowNumber: row.rowNumber, planRow });
    }

    refreshIssueCounters(summary, issues, actions);
    if (!dryRun && summary.blocking_errors === 0) {
      const planRows = actions.map((action) => action.planRow);
      const requestId = await reservationSyncRequestId(input.clientId, planRows);
      const result = await input.adapter.applyAtomicPlan(input.clientId, requestId, planRows);
      summary.run_id = result.run_id;
      summary.inserts = result.inserted;
      summary.updates = result.updated;
      summary.skips = result.skipped;
      summary.idempotent_replay = result.idempotent_replay;
      if (result.status !== 'completed' || result.errors > 0) {
        issues.push(issue(0, result.error_code ?? 'ATOMIC_SYNC_FAILED', 'blocking_error'));
      }
    }

    refreshIssueCounters(summary, issues, actions);
    summary.status = summary.blocking_errors > 0 ? 'failed' : (summary.warnings > 0 || summary.rows_excluded > 0 ? 'partial' : 'completed');
  } catch (error) {
    issues.push(issue(0, 'SYNC_FAILED', 'blocking_error'));
    refreshIssueCounters(summary, issues, []);
    summary.status = 'failed';
    if (dryRun) throw error;
  }

  return summary;
}
