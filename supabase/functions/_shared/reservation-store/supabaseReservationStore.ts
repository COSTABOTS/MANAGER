import type {
  AvailabilityQuery,
  AvailabilityResult,
  ReservationRecord,
  ReservationStore,
  ReservationStoreClientContext,
} from './types.ts';

interface QueryError {
  message: string;
}

interface QueryResult {
  data: unknown;
  error: QueryError | null;
}

export interface SupabaseReadQuery extends PromiseLike<QueryResult> {
  select(columns: string): SupabaseReadQuery;
  eq(column: string, value: unknown): SupabaseReadQuery;
  is(column: string, value: null): SupabaseReadQuery;
  in(column: string, values: unknown[]): SupabaseReadQuery;
  order(column: string, options?: { ascending?: boolean }): SupabaseReadQuery;
  limit(count: number): SupabaseReadQuery;
  maybeSingle(): SupabaseReadQuery;
}

export interface SupabaseReadClient {
  from(table: string): SupabaseReadQuery;
}

type SupabaseReservationReader = Pick<
  ReservationStore,
  'name' | 'getAvailability' | 'listReservations' | 'getReservation'
>;

type DatabaseRow = Record<string, unknown>;

const ACTIVE_STATUSES = new Set(['confirmed', 'pending']);
const INACTIVE_STATUSES = new Set(['cancelled', 'no_show']);
const ACTIVE_LEGACY_STATUSES = new Set(['CONFIRMADA', 'CONFIRMED']);
const INACTIVE_LEGACY_STATUSES = new Set(['CANCELADA', 'CANCELLED', 'NO_SHOW']);

function toStringValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function toNumberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBooleanValue(value: unknown) {
  return value === true;
}

function normalizeTime(value: unknown) {
  const raw = toStringValue(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : raw;
}

function normalizeDatabaseDate(value: unknown) {
  const raw = toStringValue(value);
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return raw;
  }

  const legacyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return legacyMatch
    ? `${legacyMatch[3]}-${legacyMatch[2].padStart(2, '0')}-${legacyMatch[1].padStart(2, '0')}`
    : raw;
}

function normalizeLegacyDate(value: unknown) {
  const raw = toStringValue(value);
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return isoMatch ? `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}` : raw;
}

function normalizeStatus(row: DatabaseRow) {
  const legacyStatus = toStringValue(row.legacy_status).toUpperCase();
  if (legacyStatus) {
    return legacyStatus;
  }

  const status = toStringValue(row.status).toLowerCase();
  return ({
    confirmed: 'CONFIRMADA',
    cancelled: 'CANCELADA',
    pending: 'PENDIENTE',
    completed: 'COMPLETADA',
    no_show: 'NO_SHOW',
    legacy_unknown: 'LEGACY_UNKNOWN',
  } as Record<string, string>)[status] ?? status.toUpperCase();
}

function normalizeOrigin(row: DatabaseRow) {
  const legacySource = toStringValue(row.legacy_source).toUpperCase();
  if (legacySource) {
    return legacySource;
  }

  const source = toStringValue(row.source_channel).toLowerCase();
  return ({
    typebot: 'BOT',
    manager_manual: 'MANUAL',
    walk_in: 'WALK-IN',
    widget: 'WIDGET',
    whatsapp_ai: 'WHATSAPP',
    phone: 'PHONE',
    api_partner: 'API_PARTNER',
    demo: 'DEMO',
    legacy_unknown: 'LEGACY_UNKNOWN',
  } as Record<string, string>)[source] ?? source.toUpperCase();
}

export function isReservationActiveForCapacity(row: DatabaseRow) {
  const status = toStringValue(row.status).toLowerCase();
  const legacyStatus = toStringValue(row.legacy_status).toUpperCase();

  if (INACTIVE_STATUSES.has(status) || INACTIVE_LEGACY_STATUSES.has(legacyStatus)) {
    return false;
  }

  return ACTIVE_STATUSES.has(status) || ACTIVE_LEGACY_STATUSES.has(legacyStatus);
}

function requireRows(result: QueryResult, operation: string): DatabaseRow[] {
  if (result.error) {
    throw new Error(`SUPABASE_RESERVATION_STORE_${operation}: ${result.error.message}`);
  }
  return Array.isArray(result.data) ? result.data as DatabaseRow[] : [];
}

function requireOptionalRow(result: QueryResult, operation: string): DatabaseRow | null {
  if (result.error) {
    throw new Error(`SUPABASE_RESERVATION_STORE_${operation}: ${result.error.message}`);
  }
  return result.data && typeof result.data === 'object' ? result.data as DatabaseRow : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export class SupabaseReservationStore implements SupabaseReservationReader {
  readonly name = 'supabase' as const;
  private readonly context: ReservationStoreClientContext;
  private readonly dbClient: SupabaseReadClient;

  constructor(
    context: ReservationStoreClientContext,
    dbClient: SupabaseReadClient,
  ) {
    this.context = context;
    this.dbClient = dbClient;
  }

  async getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    const bookingDate = normalizeDatabaseDate(query.date);
    const capacityResult = await this.dbClient
      .from('booking_capacity_slots')
      .select('slot_time,capacity,active')
      .eq('client_id', this.context.clientId)
      .eq('active', true)
      .is('service', null)
      .is('weekday', null)
      .is('valid_from', null)
      .is('valid_until', null)
      .order('slot_time', { ascending: true });
    const reservationResult = await this.dbClient
      .from('reservations')
      .select('booking_date,booking_time,pax,status,legacy_status')
      .eq('client_id', this.context.clientId)
      .eq('booking_date', bookingDate);

    const capacityRows = requireRows(capacityResult, 'GET_AVAILABILITY_CAPACITY_FAILED');
    const reservationRows = requireRows(reservationResult, 'GET_AVAILABILITY_RESERVATIONS_FAILED');
    const activeReservations = reservationRows.filter(isReservationActiveForCapacity);
    const availableTimes: string[] = [];

    for (const slot of capacityRows) {
      const slotTime = normalizeTime(slot.slot_time);
      const capacity = toNumberValue(slot.capacity);
      if (!slotTime || capacity <= 0 || slot.active !== true) {
        continue;
      }

      const occupied = activeReservations
        .filter((reservation) => normalizeTime(reservation.booking_time) === slotTime)
        .reduce((total, reservation) => total + toNumberValue(reservation.pax), 0);
      if (occupied + query.requestedPax <= capacity) {
        availableTimes.push(slotTime);
      }
    }

    const requestedTime = normalizeTime(query.requestedTime);
    return {
      requestedPax: query.requestedPax,
      availableTimes,
      requestedTimeAvailable: Boolean(requestedTime) && availableTimes.includes(requestedTime),
    };
  }

  async listReservations(): Promise<ReservationRecord[]> {
    // Provisional Manager order. Before activation, compare with booking_date,
    // booking_time, created_at, id and confirm the external ordering contract.
    const result = await this.dbClient
      .from('reservations')
      .select('id,legacy_reservation_id,public_reference,booking_date,booking_time,customer_name,customer_phone,pax,locale,legacy_locale,special_request,status,legacy_status,source_channel,legacy_source,table_id,resource_id,room,arrived,feedback_sent,service,balinese_package,created_at')
      .eq('client_id', this.context.clientId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    const rows = requireRows(result, 'LIST_RESERVATIONS_FAILED');
    return this.mapReservations(rows);
  }

  async getReservation(id: string): Promise<ReservationRecord | null> {
    const normalizedId = toStringValue(id);
    if (!normalizedId) {
      return null;
    }

    const candidates: Array<[string, string]> = [
      ['legacy_reservation_id', normalizedId],
      ['public_reference', normalizedId],
    ];
    if (isUuid(normalizedId)) {
      candidates.push(['id', normalizedId]);
    }

    for (const [column, value] of candidates) {
      const result = await this.dbClient
        .from('reservations')
        .select('id,legacy_reservation_id,public_reference,booking_date,booking_time,customer_name,customer_phone,pax,locale,legacy_locale,special_request,status,legacy_status,source_channel,legacy_source,table_id,resource_id,room,arrived,feedback_sent,service,balinese_package,created_at')
        .eq('client_id', this.context.clientId)
        .eq(column, value)
        .limit(1)
        .maybeSingle();
      const row = requireOptionalRow(result, 'GET_RESERVATION_FAILED');
      if (row) {
        return (await this.mapReservations([row]))[0] ?? null;
      }
    }

    return null;
  }

  private async mapReservations(rows: DatabaseRow[]): Promise<ReservationRecord[]> {
    if (rows.length === 0) {
      return [];
    }

    const tableIds = [...new Set(rows.map((row) => toStringValue(row.table_id)).filter(Boolean))];
    const resourceIds = [...new Set(rows.map((row) => toStringValue(row.resource_id)).filter(Boolean))];
    const [tableLabels, resourceLabels] = await Promise.all([
      this.loadLabels('restaurant_tables', tableIds),
      this.loadLabels('reservable_resources', resourceIds),
    ]);

    return rows.map((row) => ({
      id: toStringValue(row.legacy_reservation_id) || toStringValue(row.public_reference) || toStringValue(row.id),
      date: normalizeLegacyDate(row.booking_date),
      time: normalizeTime(row.booking_time),
      name: toStringValue(row.customer_name),
      phone: toStringValue(row.customer_phone),
      pax: toNumberValue(row.pax),
      language: (toStringValue(row.legacy_locale) || toStringValue(row.locale) || 'ES').toUpperCase(),
      specialRequest: toStringValue(row.special_request),
      status: normalizeStatus(row),
      origin: normalizeOrigin(row),
      table: tableLabels.get(toStringValue(row.table_id)) ?? '',
      arrived: toBooleanValue(row.arrived),
      feedbackSent: toBooleanValue(row.feedback_sent),
      room: toStringValue(row.room),
      service: toStringValue(row.service).toUpperCase(),
      balinesePackage: toStringValue(row.balinese_package),
      resource: resourceLabels.get(toStringValue(row.resource_id)) ?? '',
    }));
  }

  private async loadLabels(table: 'restaurant_tables' | 'reservable_resources', ids: string[]) {
    if (ids.length === 0) {
      return new Map<string, string>();
    }

    const result = await this.dbClient
      .from(table)
      .select('id,label')
      .eq('client_id', this.context.clientId)
      .in('id', ids);
    const rows = requireRows(result, `LOAD_${table.toUpperCase()}_FAILED`);
    return new Map(rows.map((row) => [toStringValue(row.id), toStringValue(row.label)]));
  }
}
