import type {
  AvailabilityQuery,
  AvailabilityResult,
  ReservationRecord,
  ReservationStore,
  ReservationStoreClientContext,
  CreateReservationCommand,
  CreateReservationResult,
  ReservationMutationResult,
  CreateFeedbackCommand,
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
  rpc?(name: string, params: Record<string, unknown>): PromiseLike<QueryResult>;
}

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

function normalizeService(value: unknown) {
  return toStringValue(value).toUpperCase();
}

function isApplicableService(value: unknown, requestedService: string) {
  const service = toStringValue(value);
  return !requestedService || !service || service.toUpperCase() === requestedService;
}

function isDateWithinRule(date: string, from: unknown, until: unknown) {
  const validFrom = normalizeDatabaseDate(from);
  const validUntil = normalizeDatabaseDate(until);
  return (!validFrom || validFrom <= date) && (!validUntil || validUntil >= date);
}

function getIsoWeekday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
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

export class SupabaseReservationStore implements ReservationStore {
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
    const requestedService = normalizeService(query.service);
    const capacityResult = await this.dbClient
      .from('booking_capacity_slots')
      .select('slot_time,capacity,active,service,weekday,valid_from,valid_until')
      .eq('client_id', this.context.clientId)
      .eq('active', true)
      .order('slot_time', { ascending: true });
    const reservationResult = await this.dbClient
      .from('reservations')
      .select('booking_date,booking_time,service,pax,status,legacy_status')
      .eq('client_id', this.context.clientId)
      .eq('booking_date', bookingDate);
    const dayControlResult = await this.dbClient
      .from('booking_day_controls')
      .select('service,status,fully_booked,capacity_override')
      .eq('client_id', this.context.clientId)
      .eq('booking_date', bookingDate);
    const blockResult = await this.dbClient
      .from('booking_blocks')
      .select('service,starts_at,ends_at,capacity_reduction,active')
      .eq('client_id', this.context.clientId)
      .eq('booking_date', bookingDate)
      .eq('active', true);

    const capacityRows = requireRows(capacityResult, 'GET_AVAILABILITY_CAPACITY_FAILED');
    const reservationRows = requireRows(reservationResult, 'GET_AVAILABILITY_RESERVATIONS_FAILED');
    const dayControlRows = requireRows(dayControlResult, 'GET_AVAILABILITY_DAY_CONTROLS_FAILED')
      .filter((row) => isApplicableService(row.service, requestedService));
    const blockRows = requireRows(blockResult, 'GET_AVAILABILITY_BLOCKS_FAILED')
      .filter((row) => isApplicableService(row.service, requestedService) && row.active === true);
    const weekday = getIsoWeekday(bookingDate);
    const applicableCapacityRows = capacityRows.filter((row) => {
      const ruleWeekday = row.weekday === null || row.weekday === undefined ? null : toNumberValue(row.weekday);
      return row.active === true
        && isApplicableService(row.service, requestedService)
        && (ruleWeekday === null || ruleWeekday === weekday)
        && isDateWithinRule(bookingDate, row.valid_from, row.valid_until);
    });
    const activeReservations = reservationRows.filter((row) =>
      (!requestedService || normalizeService(row.service) === requestedService)
      && isReservationActiveForCapacity(row)
    );
    const availableTimes: string[] = [];

    if (dayControlRows.some((row) => toStringValue(row.status).toLowerCase() === 'closed' || row.fully_booked === true)) {
      return { requestedPax: query.requestedPax, availableTimes, requestedTimeAvailable: false };
    }

    const capacityOverride = dayControlRows.reduce<number | null>((maximum, row) => {
      if (row.capacity_override === null || row.capacity_override === undefined) return maximum;
      const value = toNumberValue(row.capacity_override);
      return maximum === null ? value : Math.max(maximum, value);
    }, null);

    const slots = [...new Set(applicableCapacityRows.map((row) => normalizeTime(row.slot_time)).filter(Boolean))];

    for (const slotTime of slots) {
      const slotCapacity = applicableCapacityRows
        .filter((row) => normalizeTime(row.slot_time) === slotTime)
        .reduce((maximum, row) => Math.max(maximum, toNumberValue(row.capacity)), 0);
      const reduction = blockRows
        .filter((row) => {
          const startsAt = normalizeTime(row.starts_at);
          const endsAt = normalizeTime(row.ends_at);
          return (!startsAt || startsAt <= slotTime) && (!endsAt || endsAt > slotTime);
        })
        .reduce((total, row) => total + toNumberValue(row.capacity_reduction), 0);
      const capacity = Math.max(0, (capacityOverride ?? slotCapacity) - reduction);
      if (capacity <= 0) continue;

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
      .select('id,legacy_reservation_id,public_reference,booking_date,booking_time,customer_name,customer_phone,pax,locale,legacy_locale,special_request,status,legacy_status,source_channel,legacy_source,table_id,resource_id,room,arrived,feedback_sent,service,balinese_package,balinese_paid,created_at')
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
        .select('id,legacy_reservation_id,public_reference,booking_date,booking_time,customer_name,customer_phone,pax,locale,legacy_locale,special_request,status,legacy_status,source_channel,legacy_source,table_id,resource_id,room,arrived,feedback_sent,service,balinese_package,balinese_paid,created_at')
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

  async createReservation(command: CreateReservationCommand): Promise<CreateReservationResult> {
    if (!this.dbClient.rpc) throw new Error('SUPABASE_RESERVATION_STORE_RPC_UNAVAILABLE');
    const result = await this.dbClient.rpc('create_hospitality_reservation', {
      p_client_id: this.context.clientId,
      p_idempotency_key: command.id,
      p_reservation: await this.toDatabasePayload(command, 'typebot'),
    });
    if (result.error) throw new Error(`SUPABASE_RESERVATION_STORE_CREATE_FAILED: ${result.error.message}`);
    return { reservation: command };
  }

  async createBalineseReservation(command: CreateReservationCommand): Promise<CreateReservationResult> {
    if (!this.dbClient.rpc) throw new Error('SUPABASE_RESERVATION_STORE_RPC_UNAVAILABLE');
    const result = await this.dbClient.rpc('create_hospitality_balinese_reservation', {
      p_client_id: this.context.clientId,
      p_idempotency_key: command.id,
      p_reservation: await this.toDatabasePayload(command, 'typebot'),
    });
    if (result.error) {
      const message = String(result.error.message ?? '');
      if (message.includes('NO_RESOURCE_AVAILABLE') || message.includes('NO_RESOURCE_WITH_CAPACITY')) {
        throw new Error(message.includes('NO_RESOURCE_AVAILABLE') ? 'NO_RESOURCE_AVAILABLE' : 'NO_RESOURCE_WITH_CAPACITY');
      }
      throw new Error(`SUPABASE_RESERVATION_STORE_CREATE_FAILED: ${message}`);
    }
    const assignedResource = result.data && typeof result.data === 'object' && 'resource_label' in result.data
      ? String((result.data as Record<string, unknown>).resource_label ?? '')
      : command.resource;
    return { reservation: { ...command, resource: assignedResource } };
  }

  async createManualReservation(command: CreateReservationCommand) {
    await this.insertDirect(command, 'manager_manual');
    return { reservation: command };
  }

  async createWalkIn(command: CreateReservationCommand) {
    await this.insertDirect(command, 'walk_in');
    return { reservation: command };
  }

  async cancelReservation(id: string): Promise<ReservationMutationResult> {
    return await this.updateLogical(id, { status: 'cancelled', legacy_status: 'CANCELADA' });
  }

  async updateArrival(id: string, arrived: boolean): Promise<ReservationMutationResult> {
    return await this.updateLogical(id, { arrived });
  }

  async assignTable(id: string, table: string): Promise<ReservationMutationResult> {
    let tableId: string | null = null;
    if (table) {
      const lookup = await (this.dbClient.from('restaurant_tables') as any).select('id').eq('client_id', this.context.clientId).eq('label', table).limit(1).maybeSingle();
      if (lookup.error || !lookup.data) throw new Error('SUPABASE_RESERVATION_STORE_TABLE_NOT_FOUND');
      tableId = String(lookup.data.id);
    }
    return await this.updateLogical(id, { table_id: tableId });
  }

  async updateReservationPhone(id: string, phone: string): Promise<ReservationMutationResult> {
    return await this.updateLogical(id, { customer_phone: phone });
  }

  async getFeedbackByReservation(id: string): Promise<boolean> {
    const physicalId = await this.findPhysicalId(id);
    if (!physicalId) return false;
    const result = await this.dbClient.from('feedbacks').select('id')
      .eq('client_id', this.context.clientId).eq('reservation_id', physicalId).limit(1).maybeSingle();
    return Boolean(requireOptionalRow(result, 'GET_FEEDBACK_FAILED'));
  }

  async createFeedback(command: CreateFeedbackCommand): Promise<{ created: boolean }> {
    const physicalId = await this.findPhysicalId(command.reservationId);
    if (!physicalId) throw new Error('SUPABASE_RESERVATION_STORE_RESERVATION_NOT_FOUND');
    if (await this.getFeedbackByReservation(command.reservationId)) return { created: false };
    const result = await (this.dbClient.from('feedbacks') as any).insert({
      client_id: this.context.clientId,
      reservation_id: physicalId,
      legacy_reservation_id: command.reservationId,
      rating: command.rating,
      comment: command.comment || null,
      submitted_at: command.submittedAt,
    }).select('id').maybeSingle();
    if (result.error) {
      // The unique (client_id,reservation_id) index also closes concurrent duplicates.
      if (String(result.error.code) === '23505') return { created: false };
      throw new Error(`SUPABASE_RESERVATION_STORE_CREATE_FEEDBACK_FAILED: ${result.error.message}`);
    }
    return { created: true };
  }

  async markPreDinnerSent(id: string): Promise<ReservationMutationResult> {
    return await this.updateLogical(id, { pre_dinner_sent: true });
  }

  async markFeedbackSent(id: string): Promise<ReservationMutationResult> {
    return await this.updateLogical(id, { feedback_sent: true });
  }

  async updateBalinesePaid(id: string, paid: boolean): Promise<ReservationMutationResult> {
    const reservation = await this.getReservation(id);
    if (!reservation) throw new Error('SUPABASE_RESERVATION_STORE_RESERVATION_NOT_FOUND');
    if (reservation.service.toUpperCase() !== 'BALINESA') throw new Error('SUPABASE_RESERVATION_STORE_NOT_BALINESE');
    return await this.updateLogical(id, { balinese_paid: paid });
  }

  async listPendingReminderReservations(date: string): Promise<ReservationRecord[]> {
    return await this.listPending(date, 'pre_dinner_sent', false);
  }

  async listPendingFeedbackReservations(date: string): Promise<ReservationRecord[]> {
    return await this.listPending(date, 'feedback_sent', true);
  }

  private async insertDirect(command: CreateReservationCommand, channel: string) {
    const payload = await this.toDatabasePayload(command, channel);
    const result = await (this.dbClient.from('reservations') as any).insert(payload).select('id').maybeSingle();
    if (result.error) throw new Error(`SUPABASE_RESERVATION_STORE_CREATE_FAILED: ${result.error.message}`);
  }

  private async toDatabasePayload(command: CreateReservationCommand, channel: string) {
    let tableId: string | null = null;
    let resourceId: string | null = null;
    if (command.table) {
      const result = await (this.dbClient.from('restaurant_tables') as any).select('id').eq('client_id', this.context.clientId).eq('label', command.table).limit(1).maybeSingle();
      if (result.error || !result.data) throw new Error('SUPABASE_RESERVATION_STORE_TABLE_NOT_FOUND');
      tableId = String(result.data.id);
    }
    if (command.resource) {
      const resourceValue = String(command.resource).trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(resourceValue);
      const result = isUuid
        ? await (this.dbClient.from('reservable_resources') as any).select('id').eq('client_id', this.context.clientId).eq('id', resourceValue).limit(1).maybeSingle()
        : await (this.dbClient.from('reservable_resources') as any).select('id').eq('client_id', this.context.clientId).eq('label', resourceValue).limit(1).maybeSingle();
      if (result.error || !result.data) throw new Error('SUPABASE_RESERVATION_STORE_RESOURCE_NOT_FOUND');
      resourceId = String(result.data.id);
    }
    return {
      client_id: this.context.clientId, legacy_reservation_id: command.id, public_reference: command.id,
      booking_date: normalizeDatabaseDate(command.date), booking_time: normalizeTime(command.time), service: command.service || 'CENA',
      customer_name: command.name || null, customer_phone: command.phone || null, pax: command.pax,
      locale: command.language.toLowerCase(), legacy_locale: command.language, special_request: command.specialRequest || null,
      status: command.status === 'CANCELADA' ? 'cancelled' : 'confirmed', legacy_status: command.status,
      source_channel: channel, legacy_source: command.origin, table_id: tableId, resource_id: resourceId, room: command.room || null,
      arrived: command.arrived, feedback_sent: command.feedbackSent, balinese_package: command.balinesePackage || null,
      legacy_created_at: command.createdAt || null, legacy_updated_at: command.updatedAt || null,
    };
  }

  private async updateLogical(id: string, patch: Record<string, unknown>): Promise<ReservationMutationResult> {
    const physicalId = await this.findPhysicalId(id);
    if (!physicalId) throw new Error('SUPABASE_RESERVATION_STORE_RESERVATION_NOT_FOUND');
    const result = await (this.dbClient.from('reservations') as any).update(patch).eq('client_id', this.context.clientId).eq('id', physicalId).select('id').maybeSingle();
    if (result.error || !result.data) throw new Error('SUPABASE_RESERVATION_STORE_UPDATE_FAILED');
    const reservation = await this.getReservation(physicalId);
    if (!reservation) throw new Error('SUPABASE_RESERVATION_STORE_RESERVATION_NOT_FOUND');
    return { reservation };
  }

  private async findPhysicalId(id: string): Promise<string | null> {
    const normalized = toStringValue(id);
    const candidates: Array<[string, string]> = [['legacy_reservation_id', normalized], ['public_reference', normalized]];
    if (isUuid(normalized)) candidates.push(['id', normalized]);
    for (const [column, value] of candidates) {
      const result = await (this.dbClient.from('reservations') as any).select('id').eq('client_id', this.context.clientId).eq(column, value).limit(1).maybeSingle();
      if (result.error) throw new Error(`SUPABASE_RESERVATION_STORE_GET_RESERVATION_FAILED: ${result.error.message}`);
      if (result.data?.id) return String(result.data.id);
    }
    return null;
  }

  private async listPending(date: string, sentColumn: 'pre_dinner_sent' | 'feedback_sent', requireArrival: boolean) {
    let query = (this.dbClient.from('reservations') as any)
      .select('id,legacy_reservation_id,public_reference,booking_date,booking_time,customer_name,customer_phone,pax,locale,legacy_locale,special_request,status,legacy_status,source_channel,legacy_source,table_id,resource_id,room,arrived,feedback_sent,pre_dinner_sent,service,balinese_package,balinese_paid,created_at')
      .eq('client_id', this.context.clientId)
      .eq('booking_date', normalizeDatabaseDate(date))
      .eq(sentColumn, false);
    if (requireArrival) query = query.eq('arrived', true);
    const rows = requireRows(await query.order('booking_time', { ascending: true }), 'LIST_PENDING_FAILED');
    const mapped = await this.mapReservations(rows, true);
    return mapped.filter((row) => {
      const active = ['CONFIRMADA', 'CONFIRMED', 'PENDIENTE', 'PENDING'].includes(row.status.toUpperCase());
      return active && (sentColumn === 'feedback_sent' ? !row.feedbackSent : !row.preDinnerSent);
    });
  }

  private async mapReservations(rows: DatabaseRow[], includeDeliveryState = false): Promise<ReservationRecord[]> {
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
      balinesePaid: toBooleanValue(row.balinese_paid),
      resource: resourceLabels.get(toStringValue(row.resource_id)) ?? '',
      sourceChannel: toStringValue(row.source_channel).toLowerCase(),
      ...(includeDeliveryState ? {
        createdAt: toStringValue(row.created_at),
        preDinnerSent: toBooleanValue(row.pre_dinner_sent),
      } : {}),
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
