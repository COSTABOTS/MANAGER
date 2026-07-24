import { normalizePhone, toStringValue } from './normalization.ts';

export interface CreateReservationInput {
  client_id?: unknown;
  clientId?: unknown;
  public_token?: unknown;
  publicToken?: unknown;
  nombre?: unknown;
  telefono?: unknown;
  fecha?: unknown;
  hora?: unknown;
  personas?: unknown;
  pax?: unknown;
  PAX?: unknown;
  servicio?: unknown;
  SERVICIO?: unknown;
  idioma?: unknown;
  IDIOMA?: unknown;
  origen?: unknown;
  ORIGEN?: unknown;
  habitacion?: unknown;
  HABITACION?: unknown;
  peticion?: unknown;
  PETICION?: unknown;
  peticion_especial?: unknown;
}

export interface NormalizedReservationInput {
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  personas: number;
  servicio: string;
  idioma: 'ES' | 'EN';
  origen: string;
  habitacion: string;
  peticion: string;
}

export type ReservationRow = [
  string,
  string,
  string,
  string,
  string,
  number,
  'ES' | 'EN',
  string,
  'CONFIRMADA',
  string,
  '',
  'FALSE',
  'FALSE',
  string,
  string,
  string,
  string,
  '',
  '',
];

export interface CreateReservationResult {
  idReserva: string;
  normalized: NormalizedReservationInput;
  row: ReservationRow;
}

interface ValidationResult {
  normalized?: NormalizedReservationInput;
  missingFields: string[];
  invalidFields: string[];
}

function pickBodyValue(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = body[key] ?? body[key.toUpperCase()] ?? body[key.toLowerCase()];
    if (value !== undefined && value !== null && toStringValue(value) !== '') {
      return value;
    }
  }

  return '';
}

function isValidDateParts(year: number, month: number, day: number) {
  if (year < 1900 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function normalizeReservationDateForSheet(value: unknown) {
  const raw = toStringValue(value);
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return isValidDateParts(year, month, day)
      ? `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
      : '';
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    return isValidDateParts(year, month, day)
      ? `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
      : '';
  }

  return '';
}

export function normalizeReservationTimeForSheet(value: unknown) {
  const raw = toStringValue(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return '';
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return '';
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeReservationLanguage(value: unknown) {
  const raw = toStringValue(value).toUpperCase();
  if (!raw) {
    return 'ES';
  }

  return raw === 'ES' || raw === 'EN' ? raw : '';
}

function normalizeReservationService(value: unknown) {
  return toStringValue(value).toUpperCase();
}

function normalizeReservationOrigin(value: unknown) {
  return toStringValue(value).toUpperCase() || 'BOT';
}

function parseReservationPax(value: unknown) {
  const raw = toStringValue(value);
  if (!/^\d+$/.test(raw)) {
    return 0;
  }

  return Number(raw);
}

function makeReservationIdSuffix() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function makePublicReservationId(now = Date.now()) {
  return `RES-${now}-${makeReservationIdSuffix()}`;
}

export function normalizeCreateReservationInput(body: Record<string, unknown>): ValidationResult {
  const nombre = toStringValue(pickBodyValue(body, ['nombre', 'NOMBRE']));
  const telefonoInput = pickBodyValue(body, ['telefono', 'TELEFONO']);
  const fecha = normalizeReservationDateForSheet(pickBodyValue(body, ['fecha', 'FECHA']));
  const hora = normalizeReservationTimeForSheet(pickBodyValue(body, ['hora', 'HORA']));
  const personasInput = pickBodyValue(body, ['personas', 'pax', 'PAX']);
  const personas = parseReservationPax(personasInput);
  const servicio = normalizeReservationService(pickBodyValue(body, ['servicio', 'SERVICIO']));
  const idioma = normalizeReservationLanguage(pickBodyValue(body, ['idioma', 'IDIOMA']));
  const origen = normalizeReservationOrigin(pickBodyValue(body, ['origen', 'ORIGEN']));
  const habitacion = toStringValue(pickBodyValue(body, ['habitacion', 'HABITACION']));
  const peticion = toStringValue(pickBodyValue(body, ['peticion', 'PETICION', 'peticion_especial']));

  const missingFields = [
    !toStringValue(body.client_id ?? body.clientId) ? 'client_id' : '',
    !toStringValue(body.public_token ?? body.publicToken) ? 'public_token' : '',
    !nombre ? 'nombre' : '',
    !toStringValue(pickBodyValue(body, ['fecha', 'FECHA'])) ? 'fecha' : '',
    !toStringValue(pickBodyValue(body, ['hora', 'HORA'])) ? 'hora' : '',
    !toStringValue(personasInput) ? 'personas' : '',
    !servicio ? 'servicio' : '',
  ].filter(Boolean);

  const invalidFields = [
    toStringValue(pickBodyValue(body, ['fecha', 'FECHA'])) && !fecha ? 'fecha' : '',
    toStringValue(pickBodyValue(body, ['hora', 'HORA'])) && !hora ? 'hora' : '',
    toStringValue(personasInput) && personas <= 0 ? 'personas' : '',
    idioma ? '' : 'idioma',
  ].filter(Boolean);

  if (missingFields.length > 0 || invalidFields.length > 0) {
    return { missingFields, invalidFields };
  }

  return {
    missingFields,
    invalidFields,
    normalized: {
      nombre,
      telefono: telefonoInput ? normalizePhone(telefonoInput) || toStringValue(telefonoInput) : '',
      fecha,
      hora,
      personas,
      servicio,
      idioma,
      origen,
      habitacion,
      peticion,
    },
  };
}

export function buildReservationRow(
  idReserva: string,
  reservation: NormalizedReservationInput,
  timestampIso: string,
): ReservationRow {
  return [
    idReserva,
    reservation.fecha,
    reservation.hora,
    reservation.nombre,
    reservation.telefono,
    reservation.personas,
    reservation.idioma,
    reservation.peticion,
    'CONFIRMADA',
    reservation.origen,
    '',
    'FALSE',
    'FALSE',
    reservation.habitacion,
    timestampIso,
    timestampIso,
    reservation.servicio,
    '',
    '',
  ];
}

export function buildCreateReservationResult(
  reservation: NormalizedReservationInput,
  now = new Date(),
): CreateReservationResult {
  const idReserva = makePublicReservationId(now.getTime());
  const timestampIso = now.toISOString();

  return {
    idReserva,
    normalized: reservation,
    row: buildReservationRow(idReserva, reservation, timestampIso),
  };
}
