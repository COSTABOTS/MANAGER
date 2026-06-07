import type { BookingSource, BookingStatus, Reservation } from '../types';

export type SheetReservationRow = Record<string, unknown>;

export function unwrapValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => item !== undefined && item !== null && item !== '') ?? '';
  }

  return value;
}

export function pick(row: SheetReservationRow | undefined, keys: string[]) {
  for (const key of keys) {
    const value = unwrapValue(row?.[key]);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return '';
}

export function toStringValue(value: unknown) {
  const unwrappedValue = unwrapValue(value);
  return unwrappedValue === undefined || unwrappedValue === null ? '' : String(unwrappedValue).trim();
}

export function toNumberValue(value: unknown) {
  const unwrappedValue = unwrapValue(value);
  const parsedNumber = Number(String(unwrappedValue ?? '').replace(',', '.'));
  return Number.isFinite(parsedNumber) ? parsedNumber : 0;
}

export function toBooleanValue(value: unknown) {
  const unwrappedValue = String(unwrapValue(value) ?? '').trim().toLowerCase();
  return ['true', '1', 'sí', 'si', 'yes', 'y'].includes(unwrappedValue);
}

function normalizeSource(source: string): BookingSource {
  const normalized = source.trim().toUpperCase();

  if (normalized === 'WALK-IN' || normalized === 'WALKIN') {
    return 'WALKIN';
  }

  if (normalized === 'MANUAL') {
    return 'MANUAL';
  }

  if (normalized === 'WEB') {
    return 'WEB';
  }

  if (normalized === 'HOTEL') {
    return 'HOTEL';
  }

  if (normalized === 'LANDBOT') {
    return 'LANDbot';
  }

  return 'BOT';
}

function normalizeStatus(status: string): BookingStatus {
  return status.trim().toUpperCase() === 'CANCELADA' ? 'CANCELADA' : 'CONFIRMADA';
}

function normalizeDate(date: string) {
  const value = date.trim();
  const spanishDate = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (spanishDate) {
    const [, day, month, year] = spanishDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return value;
}

export function normalizeReservationFromSheet(row: SheetReservationRow): Reservation | null {
  const idReserva = toStringValue(pick(row, ['id_reserva', 'idReserva', 'ID_RESERVA', 'ID_RESERVA (I)']));

  if (!idReserva) {
    console.warn('Reserva sin ID_RESERVA', row);
    return null;
  }

  const origin = toStringValue(pick(row, ['origin', 'origen', 'ORIGEN', 'ORIGEN (K)']));
  const status = toStringValue(pick(row, ['status', 'estado', 'ESTADO', 'ESTADO (H)']));

  return {
    id: idReserva,
    idReserva,
    name: toStringValue(pick(row, ['name', 'nombre', 'NOMBRE', 'NOMBRE (A)'])),
    room: toStringValue(pick(row, ['room', 'habitacion', 'HABITACION', 'HABITACION (B)'])),
    date: normalizeDate(toStringValue(pick(row, ['date', 'fecha', 'FECHA', 'FECHA (C)']))),
    time: toStringValue(pick(row, ['time', 'hora', 'HORA', 'HORA (D)'])),
    pax: toNumberValue(pick(row, ['pax', 'PAX', 'PAX (E)'])),
    specialRequest: toStringValue(
      pick(row, [
        'specialRequest',
        'special_request',
        'peticionEspecial',
        'peticiones',
        'PETICION ESPECIAL',
        'PETICION ESPECIAL (F)',
      ]),
    ),
    phone: toStringValue(pick(row, ['phone', 'telefono', 'TELEFONO', 'TELEFONO (G)'])),
    status: normalizeStatus(status),
    source: normalizeSource(origin),
    language: toStringValue(pick(row, ['language', 'idioma', 'IDIOMA', 'IDIOMA (J)'])),
    table: toStringValue(pick(row, ['table', 'mesa', 'MESA', 'MESA (L)'])),
    arrived: toBooleanValue(pick(row, ['arrived', 'llego', 'LLEGO', 'LLEGO (M)'])),
    rowNumber: toNumberValue(pick(row, ['rowNumber', 'Row number', '__ROW_NUMBER__'])),
  };
}
