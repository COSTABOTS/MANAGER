import {
  normalizeSheetReservations,
  type NormalizedSheetReservation,
  type SyncIssue,
} from './normalizeSheetReservation.ts';

export const MAX_SYNC_ROWS = 2000;
const OWNED_SOURCE_CHANNELS = new Set(['sheets', 'legacy_unknown']);

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

export interface ReservationSyncSummary {
  run_id: string | null;
  tenant: string;
  dry_run: boolean;
  status: 'completed' | 'partial' | 'failed';
  inserts: number;
  updates: number;
  deletes: 0;
  skips: number;
  would_insert: number;
  would_update: number;
  would_skip: number;
  errors: number;
  error_summary: SyncIssue[];
}

export interface ReservationSyncAdapter {
  beginRun(clientId: string): Promise<string>;
  finishRun(runId: string, summary: Omit<ReservationSyncSummary, 'run_id' | 'tenant' | 'dry_run'>): Promise<void>;
  listExisting(clientId: string, legacyReservationIds: string[]): Promise<ReservationSyncRow[]>;
  resolveTableIds(clientId: string, labels: string[]): Promise<Map<string, string>>;
  resolveResourceIds(clientId: string, labels: string[]): Promise<Map<string, string>>;
  insertReservation(row: ReservationSyncInsert): Promise<void>;
  updateOwnedReservation(
    clientId: string,
    legacyReservationId: string,
    changes: ReservationSyncUpdate,
  ): Promise<'updated' | 'protected' | 'missing'>;
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

function issue(rowNumber: number, code: string, field?: string): SyncIssue {
  return { row_number: rowNumber, code, ...(field ? { field } : {}) };
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
  const errors = [...normalized.issues];
  let runId: string | null = null;
  if (!dryRun) runId = await input.adapter.beginRun(input.clientId);

  const summary: ReservationSyncSummary = {
    run_id: runId,
    tenant: input.clientId,
    dry_run: dryRun,
    status: 'completed',
    inserts: 0,
    updates: 0,
    deletes: 0,
    skips: 0,
    would_insert: 0,
    would_update: 0,
    would_skip: 0,
    errors: 0,
    error_summary: errors,
  };

  try {
    const [existingRows, tableIds, resourceIds] = await Promise.all([
      input.adapter.listExisting(input.clientId, normalized.rows.map((row) => row.legacyReservationId)),
      input.adapter.resolveTableIds(input.clientId, unique(normalized.rows.map((row) => row.tableLabel))),
      input.adapter.resolveResourceIds(input.clientId, unique(normalized.rows.map((row) => row.resourceLabel))),
    ]);
    const existingById = new Map(existingRows.map((row) => [row.legacy_reservation_id, row]));

    for (const row of normalized.rows) {
      const tableId = row.tableLabel ? tableIds.get(row.tableLabel) ?? null : null;
      const resourceId = row.resourceLabel ? resourceIds.get(row.resourceLabel) ?? null : null;
      if (row.tableLabel && !tableId) errors.push(issue(row.rowNumber, 'REFERENCE_NOT_FOUND', 'table_id'));
      if (row.resourceLabel && !resourceId) errors.push(issue(row.rowNumber, 'REFERENCE_NOT_FOUND', 'resource_id'));

      const changes = asUpdate(row, tableId, resourceId);
      const existing = existingById.get(row.legacyReservationId);
      if (!existing) {
        summary.would_insert += 1;
        if (!dryRun) {
          try {
            await input.adapter.insertReservation({
              client_id: input.clientId,
              legacy_reservation_id: row.legacyReservationId,
              public_reference: row.legacyReservationId,
              source_channel: 'sheets',
              ...changes,
            });
            summary.inserts += 1;
          } catch {
            errors.push(issue(row.rowNumber, 'INSERT_FAILED'));
          }
        }
        continue;
      }

      if (!OWNED_SOURCE_CHANNELS.has(existing.source_channel)) {
        errors.push(issue(row.rowNumber, 'PROTECTED_SOURCE_CHANNEL', 'source_channel'));
        continue;
      }
      if (JSON.stringify(comparable(existing)) === JSON.stringify(comparable(changes))) {
        summary.would_skip += 1;
        if (!dryRun) summary.skips += 1;
        continue;
      }

      summary.would_update += 1;
      if (!dryRun) {
        try {
          const result = await input.adapter.updateOwnedReservation(input.clientId, row.legacyReservationId, changes);
          if (result !== 'updated') {
            errors.push(issue(row.rowNumber, result === 'protected' ? 'PROTECTED_SOURCE_CHANNEL' : 'UPDATE_TARGET_MISSING'));
          } else {
            summary.updates += 1;
          }
        } catch {
          summary.updates -= 1;
          errors.push(issue(row.rowNumber, 'UPDATE_FAILED'));
        }
      }
    }

    summary.errors = errors.length;
    summary.status = summary.errors > 0 ? 'partial' : 'completed';
  } catch (error) {
    errors.push(issue(0, 'SYNC_FAILED'));
    summary.errors = errors.length;
    summary.status = 'failed';
    if (dryRun) throw error;
  } finally {
    if (!dryRun && runId) {
      await input.adapter.finishRun(runId, {
        status: summary.status,
        inserts: summary.inserts,
        updates: summary.updates,
        deletes: 0,
        skips: summary.skips,
        would_insert: summary.would_insert,
        would_update: summary.would_update,
        would_skip: summary.would_skip,
        errors: summary.errors,
        error_summary: summary.error_summary,
      });
    }
  }

  return summary;
}
