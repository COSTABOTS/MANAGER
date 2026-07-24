import {
  normalizeBoolean,
  normalizeDateKey,
  normalizeLanguage,
  normalizePhone,
  normalizeService,
  normalizeTime,
  pickValue,
  rowsToObjects,
  toNumberValue,
  toStringValue,
} from './normalization.ts';
import {
  makePublicReservationId,
  normalizeReservationDateForSheet,
  normalizeReservationTimeForSheet,
} from './reservations.ts';

export interface BalineseResource {
  recursoId: string;
  recurso: string;
  zona: string;
  capacidad: number;
  activa: boolean;
  orden: number;
}

export interface BalineseReservationInput {
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  personas: number;
  idioma: 'ES' | 'EN';
  origen: string;
  habitacion: string;
  peticion: string;
  servicio: 'BALINESA';
  paquete: string;
}

export type BalineseReservationRow = [
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
  'BALINESA',
  string,
  string,
  'FALSE',
];

interface ValidationResult {
  normalized?: BalineseReservationInput;
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

function parsePositiveInteger(value: unknown) {
  const raw = toStringValue(value);
  return /^\d+$/.test(raw) ? Number(raw) : 0;
}

function normalizePublicLanguage(value: unknown): 'ES' | 'EN' {
  return normalizeLanguage(value).toUpperCase() as 'ES' | 'EN';
}

export function normalizeBalineseCreateInput(body: Record<string, unknown>): ValidationResult {
  const nombre = toStringValue(pickBodyValue(body, ['nombre', 'NOMBRE']));
  const telefonoInput = pickBodyValue(body, ['telefono', 'TELEFONO']);
  const fechaInput = pickBodyValue(body, ['fecha', 'FECHA']);
  const fecha = normalizeReservationDateForSheet(fechaInput);
  const horaInput = pickBodyValue(body, ['hora', 'HORA']);
  const hora = horaInput ? normalizeReservationTimeForSheet(horaInput) : '';
  const personasInput = pickBodyValue(body, ['personas', 'pax', 'PAX']);
  const personas = parsePositiveInteger(personasInput);
  const servicioInput = pickBodyValue(body, ['servicio', 'SERVICIO']);
  const servicio = normalizeService(servicioInput);
  const paquete = toStringValue(pickBodyValue(body, ['paquete', 'paquete_balinesa', 'PAQUETE_BALINESA', 'PAQUETE BALINESA']));
  const idioma = normalizePublicLanguage(pickBodyValue(body, ['idioma', 'lang', 'IDIOMA']));
  const origen = toStringValue(pickBodyValue(body, ['origen', 'origin', 'ORIGEN'])).toUpperCase() || 'BOT';
  const habitacion = toStringValue(pickBodyValue(body, ['habitacion', 'HABITACION']));
  const peticion = toStringValue(pickBodyValue(body, ['peticion', 'comentario', 'PETICION', 'peticion_especial']));

  const missingFields = [
    !toStringValue(body.client_id ?? body.clientId) ? 'client_id' : '',
    !toStringValue(body.public_token ?? body.publicToken) ? 'public_token' : '',
    !nombre ? 'nombre' : '',
    !toStringValue(fechaInput) ? 'fecha' : '',
    !toStringValue(personasInput) ? 'personas' : '',
    !toStringValue(servicioInput) ? 'servicio' : '',
    !paquete ? 'paquete' : '',
  ].filter(Boolean);

  const invalidFields = [
    toStringValue(fechaInput) && !fecha ? 'fecha' : '',
    toStringValue(horaInput) && !hora ? 'hora' : '',
    toStringValue(personasInput) && personas <= 0 ? 'personas' : '',
    toStringValue(servicioInput) && servicio !== 'BALINESA' ? 'servicio' : '',
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
      idioma,
      origen,
      habitacion,
      peticion,
      servicio: 'BALINESA',
      paquete,
    },
  };
}

export function normalizeBalineseResources(values: unknown[][] | undefined): BalineseResource[] {
  return rowsToObjects(values)
    .flatMap((item) => {
      const recursoId = toStringValue(pickValue(item, ['RECURSO_ID', 'ID_RECURSO', 'recurso_id', '0']));
      const recurso = toStringValue(pickValue(item, ['RECURSO', 'recurso', 'name', 'nombre', '1']));
      const zona = toStringValue(pickValue(item, ['ZONA', 'zona', 'zone', '2'])) || 'General';
      const capacidad = toNumberValue(pickValue(item, ['CAPACIDAD', 'capacidad', 'capacity', '3']));
      const activeValue = pickValue(item, ['ACTIVA', 'activa', 'ACTIVO', 'activo', 'active', '4']);
      const activa = activeValue === '' ? true : normalizeBoolean(activeValue);
      const orden = toNumberValue(pickValue(item, ['ORDEN', 'orden', 'order', '5'])) || 999;

      if (!recurso || !activa) {
        return [];
      }

      return [{
        recursoId: recursoId || `RECURSO-${recurso}`,
        recurso,
        zona,
        capacidad,
        activa,
        orden,
      }];
    })
    .sort((left, right) => left.orden - right.orden || left.recurso.localeCompare(right.recurso));
}

export function getOccupiedBalineseResources(values: unknown[][] | undefined, fecha: string) {
  const targetDate = normalizeDateKey(fecha);
  const occupied = new Set<string>();

  rowsToObjects(values).forEach((item) => {
    const rowDate = normalizeDateKey(pickValue(item, ['FECHA', 'fecha', '1']));
    const estado = toStringValue(pickValue(item, ['ESTADO', 'estado', '8'])).toUpperCase();
    const servicio = normalizeService(pickValue(item, ['SERVICIO', 'servicio', 'service', '16']));
    const recurso = toStringValue(pickValue(item, ['RECURSO', 'recurso', 'resource', '18']));

    if (rowDate === targetDate && estado === 'CONFIRMADA' && servicio === 'BALINESA' && recurso) {
      occupied.add(recurso.toUpperCase());
    }
  });

  return occupied;
}

export function findAvailableBalineseResource(
  resources: BalineseResource[],
  occupiedResources: Set<string>,
  personas: number,
) {
  const freeResources = resources.filter((resource) => !occupiedResources.has(resource.recurso.toUpperCase()));
  const resource = freeResources.find((item) => item.capacidad <= 0 || item.capacidad >= personas);

  return {
    resource,
    hasFreeResources: freeResources.length > 0,
  };
}

export function buildBalineseReservationRow(
  idReserva: string,
  reservation: BalineseReservationInput,
  recurso: string,
  timestampIso: string,
): BalineseReservationRow {
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
    'BALINESA',
    reservation.paquete,
    recurso,
    'FALSE',
  ];
}

export function buildBalineseReservationResult(reservation: BalineseReservationInput, recurso: string, now = new Date()) {
  const idReserva = makePublicReservationId(now.getTime());
  const timestampIso = now.toISOString();

  return {
    idReserva,
    row: buildBalineseReservationRow(idReserva, reservation, recurso, timestampIso),
  };
}
