import {
  normalizeDateKey,
  normalizeBoolean,
  normalizeKey,
  pickValue,
  rowsToObjects,
  toNumberValue,
  toStringValue,
} from './normalization.ts';

export interface CapacitySlot {
  hora: string;
  limite: number;
  activo: boolean;
}

export interface ReservationForAvailability {
  fecha: string;
  hora: string;
  pax: number;
  estado: string;
}

export interface AvailabilityByHourResult {
  ok: true;
  pax_solicitados: number;
  horas_disponibles: string[];
  horas_disponibles_texto: string;
}

interface HeaderIssue {
  sheet: string;
  missing_headers: string[];
}

function getMissingHeaders(values: unknown[][] | undefined, requiredHeaders: string[]) {
  const headers = new Set((values?.[0] ?? []).map((header) => normalizeKey(header)));

  return requiredHeaders.filter((header) => !headers.has(normalizeKey(header)));
}

export function getAvailabilitySheetHeaderIssues(
  capacityValues: unknown[][] | undefined,
  reservationValues: unknown[][] | undefined,
): HeaderIssue[] {
  const issues: HeaderIssue[] = [];
  const missingCapacityHeaders = getMissingHeaders(capacityValues, ['HORA', 'LIMITE', 'ACTIVO']);
  const missingReservationHeaders = getMissingHeaders(reservationValues, ['FECHA', 'HORA', 'PAX', 'ESTADO']);

  if (missingCapacityHeaders.length > 0) {
    issues.push({ sheet: 'CAPACIDAD', missing_headers: missingCapacityHeaders });
  }

  if (missingReservationHeaders.length > 0) {
    issues.push({ sheet: 'RESERVAS', missing_headers: missingReservationHeaders });
  }

  return issues;
}

export function normalizeAvailabilityTime(value: unknown) {
  const raw = toStringValue(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return raw;
  }

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function normalizeCapacitySlots(values: unknown[][] | undefined): CapacitySlot[] {
  return rowsToObjects(values).flatMap((item) => {
    const hora = normalizeAvailabilityTime(pickValue(item, ['HORA', 'hora', 'TIME', 'time']));
    const limite = toNumberValue(pickValue(item, ['LIMITE', 'limite', 'CAPACIDAD', 'capacity']));
    const activo = normalizeBoolean(pickValue(item, ['ACTIVO', 'activo', 'ACTIVE', 'active']));

    if (!hora) {
      return [];
    }

    return [{ hora, limite, activo }];
  });
}

export function normalizeReservationsForAvailability(values: unknown[][] | undefined): ReservationForAvailability[] {
  return rowsToObjects(values).flatMap((item) => {
    const fecha = normalizeDateKey(pickValue(item, ['FECHA', 'fecha', 'DATE', 'date']));
    const hora = normalizeAvailabilityTime(pickValue(item, ['HORA', 'hora', 'TIME', 'time']));
    const pax = toNumberValue(pickValue(item, ['PAX', 'pax', 'PERSONAS', 'personas']));
    const estado = toStringValue(pickValue(item, ['ESTADO', 'estado', 'STATUS', 'status'])).toUpperCase();

    if (!fecha || !hora) {
      return [];
    }

    return [{ fecha, hora, pax, estado }];
  });
}

export function getAvailableHoursByCapacity(
  capacitySlots: CapacitySlot[],
  reservations: ReservationForAvailability[],
  requestedDate: string,
  requestedPax: number,
): AvailabilityByHourResult {
  const targetDate = normalizeDateKey(requestedDate);
  const reservationsForDate = reservations.filter((reservation) => normalizeDateKey(reservation.fecha) === targetDate);
  const horasDisponibles: string[] = [];

  for (const slot of capacitySlots) {
    if (!slot.activo || !slot.hora || slot.limite <= 0) {
      continue;
    }

    const ocupados = reservationsForDate
      .filter((reservation) => reservation.estado === 'CONFIRMADA' && reservation.hora === slot.hora)
      .reduce((total, reservation) => total + reservation.pax, 0);

    if (ocupados + requestedPax <= slot.limite) {
      horasDisponibles.push(slot.hora);
    }
  }

  return {
    ok: true,
    pax_solicitados: requestedPax,
    horas_disponibles: horasDisponibles,
    horas_disponibles_texto: horasDisponibles.join(', '),
  };
}
