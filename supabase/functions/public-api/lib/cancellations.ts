import {
  normalizeLanguage,
  normalizeService,
  normalizePhone,
  pickValue,
  rowsToObjects,
  toNumberValue,
  toStringValue,
} from './normalization.ts';

export interface PublicCancellationReservation {
  rowNumber: number;
  idReserva: string;
  nombre: string;
  fecha: string;
  hora: string;
  telefono: string;
  personas: number;
  idioma: 'es' | 'en';
  estado: string;
  servicio: string;
  paqueteBalinesa: string;
  recurso: string;
}

export function normalizeCancellationReservations(values: unknown[][] | undefined): PublicCancellationReservation[] {
  return rowsToObjects(values).flatMap((item) => {
    const rowIndex = Number(item.__ROW_INDEX__);
    const idReserva = toStringValue(pickValue(item, ['ID_RESERVA', 'id_reserva', '0']));
    const nombre = toStringValue(pickValue(item, ['NOMBRE', 'nombre', '3']));
    const fecha = toStringValue(pickValue(item, ['FECHA', 'fecha', '1']));
    const hora = toStringValue(pickValue(item, ['HORA', 'hora', '2']));
    const telefono = toStringValue(pickValue(item, ['TELEFONO', 'telefono', '4']));
    const personas = toNumberValue(pickValue(item, ['PAX', 'pax', 'personas', '5']));
    const idioma = normalizeLanguage(pickValue(item, ['IDIOMA', 'idioma', '6']));
    const estado = toStringValue(pickValue(item, ['ESTADO', 'estado', '8'])).toUpperCase();
    const servicio = normalizeService(pickValue(item, ['SERVICIO', 'servicio', 'service', '16']));
    const paqueteBalinesa = toStringValue(pickValue(item, ['PAQUETE BALINESA', 'PAQUETE_BALINESA', 'paqueteBalinesa', 'paquete_balinesa', '17']));
    const recurso = toStringValue(pickValue(item, ['RECURSO', 'recurso', 'resource', '18']));

    if (!idReserva) {
      return [];
    }

    return [{
      rowNumber: rowIndex + 1,
      idReserva,
      nombre,
      fecha,
      hora,
      telefono,
      personas,
      idioma,
      estado,
      servicio,
      paqueteBalinesa,
      recurso,
    }];
  });
}

export function findCancellationReservation(rows: PublicCancellationReservation[], idReserva: unknown) {
  const targetId = toStringValue(idReserva);
  return rows.find((row) => row.idReserva === targetId) ?? null;
}

export function isConfirmedReservation(row: PublicCancellationReservation | null): row is PublicCancellationReservation {
  return row?.estado === 'CONFIRMADA';
}

export function isCancelledReservation(row: PublicCancellationReservation | null): row is PublicCancellationReservation {
  return row?.estado === 'CANCELADA';
}

export function getCancellationPhone(row: PublicCancellationReservation) {
  return normalizePhone(row.telefono);
}
