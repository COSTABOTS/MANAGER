import type { BookingService, BookingSource, Reservation } from '../types';
import { normalizeBookingStatus } from '../utils/reservationStatus';

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

function normalizeDate(date: string) {
  const value = date.trim();
  const spanishDate = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (spanishDate) {
    const [, day, month, year] = spanishDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return value;
}

function normalizeService(service: string): BookingService {
  const normalized = service.trim().toUpperCase();

  if (normalized === 'DESAYUNO' || normalized === 'ALMUERZO' || normalized === 'BALINESA') {
    return normalized;
  }

  return 'CENA';
}

export function normalizeReservationFromSheet(row: SheetReservationRow): Reservation | null {
  const idReserva = toStringValue(pick(row, ['id_reserva', 'idReserva', 'ID_RESERVA', 'ID_RESERVA (I)', '8']));

  if (!idReserva) {
    console.warn('Reserva sin ID_RESERVA', row);
    return null;
  }

  const origin = toStringValue(pick(row, ['origin', 'origen', 'ORIGEN', 'ORIGEN (K)', '10']));
  const status = toStringValue(pick(row, ['status', 'estado', 'ESTADO', 'ESTADO (H)', '7']));
  const service = toStringValue(pick(row, ['service', 'servicio', 'SERVICIO', 'SERVICIO (Q)', '16']));

  return {
    id: idReserva,
    idReserva,
    name: toStringValue(pick(row, ['name', 'nombre', 'NOMBRE', 'NOMBRE (A)', '0'])),
    room: toStringValue(pick(row, ['room', 'habitacion', 'HABITACION', 'HABITACION (B)', '1'])),
    date: normalizeDate(toStringValue(pick(row, ['date', 'fecha', 'FECHA', 'FECHA (C)', '2']))),
    time: toStringValue(pick(row, ['time', 'hora', 'HORA', 'HORA (D)', '3'])),
    pax: toNumberValue(pick(row, ['pax', 'PAX', 'PAX (E)', '4'])),
    specialRequest: toStringValue(
      pick(row, [
        'specialRequest',
        'special_request',
        'peticionEspecial',
        'peticiones',
        'PETICION ESPECIAL',
        'PETICION ESPECIAL (F)',
        '5',
      ]),
    ),
    phone: toStringValue(pick(row, ['phone', 'telefono', 'TELEFONO', 'TELEFONO (G)', '6'])),
    status: normalizeBookingStatus(status),
    source: normalizeSource(origin),
    language: toStringValue(pick(row, ['language', 'idioma', 'IDIOMA', 'IDIOMA (J)', '9'])),
    table: toStringValue(pick(row, ['table', 'mesa', 'MESA', 'MESA (L)', '11'])),
    arrived: toBooleanValue(pick(row, ['arrived', 'llego', 'LLEGO', 'LLEGO (M)', '12'])),
    service: normalizeService(service),
    balinesePackage: toStringValue(
      pick(row, ['balinesePackage', 'paqueteBalinesa', 'paquete_balinesa', 'PAQUETE BALINESA', 'PAQUETE_BALINESA', 'PAQUETE BALINESA (R)', '17']),
    ),
    resource: toStringValue(pick(row, ['resource', 'recurso', 'RECURSO', 'RECURSO (S)', '18'])),
    rowNumber: toNumberValue(pick(row, ['rowNumber', 'Row number', '__ROW_NUMBER__'])),
  };
}
