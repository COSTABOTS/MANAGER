export interface SyncIssue {
  row_number: number;
  code: string;
  severity: 'warning' | 'excluded_row' | 'blocking_error';
  field?: string;
}

export interface NormalizedSheetReservation {
  rowNumber: number;
  legacyReservationId: string;
  bookingDate: string;
  bookingTime: string | null;
  service: string;
  customerName: string | null;
  customerPhone: string | null;
  pax: number;
  locale: string | null;
  legacyLocale: string | null;
  specialRequest: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'legacy_unknown';
  legacyStatus: string | null;
  legacySource: string | null;
  tableLabel: string | null;
  resourceLabel: string | null;
  room: string | null;
  arrived: boolean;
  feedbackSent: boolean;
  preDinnerSent: boolean;
  balinesePackage: string | null;
  legacyCreatedAt: string | null;
  legacyUpdatedAt: string | null;
}

export interface NormalizeSheetResult {
  rows: NormalizedSheetReservation[];
  issues: SyncIssue[];
}

const FALLBACK_HEADERS = [
  'ID_RESERVA', 'FECHA', 'HORA', 'NOMBRE', 'TELEFONO', 'PAX', 'IDIOMA',
  'PETICION_ESPECIAL', 'ESTADO', 'ORIGEN', 'MESA', 'LLEGO',
  'FEEDBACK_ENVIADO', 'HABITACION', 'CREATED_AT', 'UPDATED_AT', 'SERVICIO',
  'PAQUETE_BALINESA', 'RECURSO', 'PRECENA_ENVIADO',
] as const;

const HEADER_ALIASES: Record<string, string[]> = {
  ID_RESERVA: ['ID_RESERVA', 'ID RESERVA'],
  FECHA: ['FECHA', 'DATE'],
  HORA: ['HORA', 'TIME'],
  NOMBRE: ['NOMBRE', 'NAME'],
  TELEFONO: ['TELEFONO', 'TELÉFONO', 'PHONE'],
  PAX: ['PAX', 'PERSONAS', 'PEOPLE'],
  IDIOMA: ['IDIOMA', 'LANGUAGE', 'LOCALE'],
  PETICION_ESPECIAL: ['PETICION_ESPECIAL', 'PETICIÓN_ESPECIAL', 'PETICION ESPECIAL', 'SPECIAL_REQUEST'],
  ESTADO: ['ESTADO', 'STATUS'],
  ORIGEN: ['ORIGEN', 'ORIGIN', 'SOURCE'],
  MESA: ['MESA', 'TABLE'],
  LLEGO: ['LLEGO', 'LLEGÓ', 'ARRIVED'],
  FEEDBACK_ENVIADO: ['FEEDBACK_ENVIADO', 'FEEDBACK SENT'],
  HABITACION: ['HABITACION', 'HABITACIÓN', 'ROOM'],
  CREATED_AT: ['CREATED_AT', 'CREATED AT'],
  UPDATED_AT: ['UPDATED_AT', 'UPDATED AT'],
  SERVICIO: ['SERVICIO', 'SERVICE'],
  PAQUETE_BALINESA: ['PAQUETE_BALINESA', 'PAQUETE BALINESA', 'BALINESE_PACKAGE'],
  RECURSO: ['RECURSO', 'RESOURCE'],
  PRECENA_ENVIADO: ['PRECENA_ENVIADO', 'PRECENA ENVIADO', 'PRE_DINNER_SENT'],
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function nullableText(value: unknown) {
  return text(value) || null;
}

function normalizedHeader(value: unknown) {
  return text(value).toUpperCase();
}

function normalizeDate(value: unknown) {
  const raw = text(value);
  const legacy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (legacy) {
    return `${legacy[3]}-${legacy[2].padStart(2, '0')}-${legacy[1].padStart(2, '0')}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function normalizeTime(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? `${String(hour).padStart(2, '0')}:${match[2]}` : '';
}

function normalizeBoolean(value: unknown) {
  return ['true', '1', 'si', 'sí', 'yes', 'y', 'on'].includes(text(value).toLowerCase());
}

function normalizeStatus(value: unknown): NormalizedSheetReservation['status'] {
  const status = text(value).toUpperCase();
  if (['CONFIRMADA', 'CONFIRMED'].includes(status)) return 'confirmed';
  if (['PENDIENTE', 'PENDING'].includes(status)) return 'pending';
  if (['CANCELADA', 'CANCELLED'].includes(status)) return 'cancelled';
  if (['COMPLETADA', 'COMPLETED'].includes(status)) return 'completed';
  if (['NO_SHOW', 'NO SHOW'].includes(status)) return 'no_show';
  return 'legacy_unknown';
}

function headerIndexes(headerRow: unknown[]) {
  const headers = headerRow.map(normalizedHeader);
  return Object.fromEntries(FALLBACK_HEADERS.map((canonical, fallback) => {
    const aliases = HEADER_ALIASES[canonical];
    const found = headers.findIndex((header) => aliases.includes(header));
    return [canonical, found >= 0 ? found : fallback];
  })) as Record<(typeof FALLBACK_HEADERS)[number], number>;
}

export function normalizeSheetReservations(values: unknown[][] | undefined): NormalizeSheetResult {
  if (!values?.length) return { rows: [], issues: [] };
  const indexes = headerIndexes(values[0] ?? []);
  const rows: NormalizedSheetReservation[] = [];
  const issues: SyncIssue[] = [];

  values.slice(1).forEach((source, offset) => {
    const rowNumber = offset + 2;
    if (!source.some((cell) => text(cell))) return;
    const get = (name: (typeof FALLBACK_HEADERS)[number]) => source[indexes[name]];
    const legacyReservationId = text(get('ID_RESERVA'));
    const bookingDate = normalizeDate(get('FECHA'));
    const bookingTime = normalizeTime(get('HORA'));
    const pax = Number(text(get('PAX')).replace(',', '.'));

    if (!legacyReservationId) {
      issues.push({ row_number: rowNumber, code: 'MISSING_LEGACY_RESERVATION_ID', severity: 'excluded_row', field: 'legacy_reservation_id' });
      return;
    }
    if (!bookingDate) {
      issues.push({ row_number: rowNumber, code: 'INVALID_BOOKING_DATE', severity: 'excluded_row', field: 'booking_date' });
      return;
    }
    if (bookingTime === '') {
      issues.push({ row_number: rowNumber, code: 'INVALID_BOOKING_TIME', severity: 'blocking_error', field: 'booking_time' });
      return;
    }
    if (!Number.isInteger(pax) || pax <= 0 || pax > 32767) {
      issues.push({ row_number: rowNumber, code: 'INVALID_PAX', severity: 'excluded_row', field: 'pax' });
      return;
    }

    const legacyStatus = nullableText(get('ESTADO'));
    const legacyLocale = nullableText(get('IDIOMA'));
    rows.push({
      rowNumber,
      legacyReservationId,
      bookingDate,
      bookingTime,
      service: text(get('SERVICIO')) || 'CENA',
      customerName: nullableText(get('NOMBRE')),
      customerPhone: nullableText(get('TELEFONO')),
      pax,
      locale: legacyLocale?.toLowerCase() ?? null,
      legacyLocale,
      specialRequest: nullableText(get('PETICION_ESPECIAL')),
      status: normalizeStatus(legacyStatus),
      legacyStatus,
      legacySource: nullableText(get('ORIGEN')),
      tableLabel: nullableText(get('MESA')),
      resourceLabel: nullableText(get('RECURSO')),
      room: nullableText(get('HABITACION')),
      arrived: normalizeBoolean(get('LLEGO')),
      feedbackSent: normalizeBoolean(get('FEEDBACK_ENVIADO')),
      preDinnerSent: normalizeBoolean(get('PRECENA_ENVIADO')),
      balinesePackage: nullableText(get('PAQUETE_BALINESA')),
      legacyCreatedAt: nullableText(get('CREATED_AT')),
      legacyUpdatedAt: nullableText(get('UPDATED_AT')),
    });
  });

  const frequencies = new Map<string, number>();
  rows.forEach((row) => frequencies.set(row.legacyReservationId, (frequencies.get(row.legacyReservationId) ?? 0) + 1));
  const duplicateIds = new Set([...frequencies].filter(([, count]) => count > 1).map(([id]) => id));
  rows.filter((row) => duplicateIds.has(row.legacyReservationId)).forEach((row) => issues.push({
    row_number: row.rowNumber,
    code: 'DUPLICATE_LEGACY_RESERVATION_ID',
    severity: 'blocking_error',
    field: 'legacy_reservation_id',
  }));

  return { rows: rows.filter((row) => !duplicateIds.has(row.legacyReservationId)), issues };
}
