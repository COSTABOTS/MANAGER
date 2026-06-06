import type { BookingSource, BookingStatus, Reservation } from '../types';

export interface SheetReservationRow {
  ID_RESERVA?: string;
  id_reserva?: string;
  idReserva?: string;
  id?: string;
  NOMBRE?: string;
  nombre?: string;
  HABITACION?: string;
  habitacion?: string;
  ROOM?: string;
  FECHA?: string;
  fecha?: string;
  HORA?: string;
  hora?: string;
  PAX?: string | number;
  pax?: string | number;
  PETICION_ESPECIAL?: string;
  peticionEspecial?: string;
  peticiones?: string;
  TELEFONO?: string;
  telefono?: string;
  ESTADO?: string;
  estado?: string;
  ORIGEN?: string;
  origen?: string;
  MESA?: string;
  mesa?: string;
  LLEGO?: string | boolean;
  llego?: string | boolean;
}

function normalizeBoolean(value: string | boolean | undefined) {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', 'verdadero', 'si', 'sí', '1', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function normalizeSource(source: string | undefined): BookingSource {
  const normalized = String(source ?? 'BOT').trim().toUpperCase();

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

function normalizeStatus(status: string | undefined): BookingStatus {
  return String(status ?? 'CONFIRMADA').trim().toUpperCase() === 'CANCELADA' ? 'CANCELADA' : 'CONFIRMADA';
}

export function normalizeReservationFromSheet(row: SheetReservationRow): Reservation {
  const idReserva = row.ID_RESERVA ?? row.id_reserva ?? row.idReserva ?? row.id ?? `RES-${Date.now()}`;

  return {
    id: idReserva,
    idReserva,
    name: row.NOMBRE ?? row.nombre ?? '',
    room: row.HABITACION ?? row.habitacion ?? row.ROOM ?? '',
    date: row.FECHA ?? row.fecha ?? '',
    time: row.HORA ?? row.hora ?? '',
    pax: Number(row.PAX ?? row.pax ?? 0),
    specialRequest: row.PETICION_ESPECIAL ?? row.peticionEspecial ?? row.peticiones ?? '',
    phone: row.TELEFONO ?? row.telefono ?? '',
    status: normalizeStatus(row.ESTADO ?? row.estado),
    source: normalizeSource(row.ORIGEN ?? row.origen),
    table: row.MESA ?? row.mesa ?? '',
    arrived: normalizeBoolean(row.LLEGO ?? row.llego),
  };
}
