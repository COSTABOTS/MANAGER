import type { PublicLanguage } from './normalization.ts';
import {
  normalizeBoolean,
  normalizeDateKey,
  normalizeKey,
  normalizeLanguage,
  normalizePhone,
  pickValue,
  rowsToObjects,
  toNumberValue,
  toStringValue,
} from './normalization.ts';
import { columnNumberToLetter } from './feedback.ts';
import { getClientBookingUrl, getClientRestaurantName } from './clientPublicData.ts';

export interface DispatchClient {
  clientId: string;
  restaurantName: string;
  bookingUrl: string;
  sheetId: string;
  publicToken: string;
}

export interface PendingFeedbackReservation {
  rowNumber: number;
  idReserva: string;
  fecha: string;
  hora: string;
  nombre: string;
  telefono: string;
  personas: number;
  idioma: PublicLanguage;
  languageFallback: boolean;
  feedbackEnviadoColumn: string;
}

export interface DispatchError {
  client_id: string;
  id_reserva?: string;
  code: string;
}

export interface PostDinnerMessageConfig {
  enabled: boolean;
  time: string;
  usedFallbackTime: boolean;
}

function getMadridDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
  };
}

function toDisplayDate(isoDate: string) {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return '';
  }

  return `${match[3]}/${match[2]}/${match[1]}`;
}

function parseTargetDate(value: unknown) {
  const normalized = normalizeDateKey(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function normalizeTimeValue(value: unknown, fallback = '12:30') {
  const rawValue = toStringValue(value);
  const match = rawValue.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

  if (!match) {
    return fallback;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function getDefaultTargetDate() {
  const { year, month, day } = getMadridDateParts();
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() - 1);
  return utcDate.toISOString().slice(0, 10);
}

export function getCurrentMadridTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';

  return `${hour}:${minute}`;
}

export function isWithinDispatchWindow(currentTime: string, configuredTime: string) {
  const currentMinutes = toMinutes(normalizeTimeValue(currentTime));
  const configuredMinutes = toMinutes(normalizeTimeValue(configuredTime));
  const diffMinutes = (currentMinutes - configuredMinutes + 1440) % 1440;

  return diffMinutes >= 0 && diffMinutes < 15;
}

export function resolveTargetDate(value: unknown) {
  return parseTargetDate(value) || getDefaultTargetDate();
}

export function formatTargetDate(value: string) {
  return toDisplayDate(value) || value;
}

export function getReservationFeedbackSentColumn(values: unknown[][] | undefined) {
  const headers = values?.[0]?.map((header) => toStringValue(header).toUpperCase()) ?? [];
  const index = headers.findIndex((header) => ['FEEDBACK_ENVIADO', 'FEEDBACK ENVIADO'].includes(header));
  return columnNumberToLetter((index >= 0 ? index : 12) + 1);
}

export function normalizeDispatchClients(rows: Array<Record<string, unknown>> | null | undefined): DispatchClient[] {
  return (rows ?? []).flatMap((client) => {
    const clientId = toStringValue(client.client_id ?? client.clientId);
    const restaurantName = getClientRestaurantName(client, 'es');
    const bookingUrl = getClientBookingUrl(client);
    const sheetId = toStringValue(client.sheet_id ?? client.sheetId);
    const publicToken = toStringValue(client.public_token ?? client.publicToken);
    const status = toStringValue(client.status).toUpperCase() || 'ACTIVE';

    if (!clientId || !sheetId || !['ACTIVE', 'TRIAL'].includes(status)) {
      return [];
    }

    return [{ clientId, restaurantName, bookingUrl, sheetId, publicToken }];
  });
}

export function getPostDinnerMessageConfig(values: unknown[][] | undefined): PostDinnerMessageConfig {
  const settings = rowsToObjects(values).reduce<Record<string, string>>((items, item) => {
    const key = toStringValue(pickValue(item, ['VARIABLE', 'variable', 'KEY', 'key', '0'])).toUpperCase();
    const value = toStringValue(pickValue(item, ['VALUE', 'value', 'VALOR', 'valor', '1']));

    if (key) {
      items[key] = value;
    }

    return items;
  }, {});
  const rawEnabled = settings.POST_DINNER_MESSAGE_ENABLED;
  const rawTime = settings.POST_DINNER_MESSAGE_TIME;
  const time = normalizeTimeValue(rawTime, '12:30');

  if (rawEnabled === undefined) {
    return {
      enabled: true,
      time,
      usedFallbackTime: rawTime === undefined || time !== toStringValue(rawTime),
    };
  }

  const normalizedValue = toStringValue(rawEnabled).toLowerCase();
  if (['false', '0', 'no', 'off', 'falso'].includes(normalizedValue)) {
    return {
      enabled: false,
      time,
      usedFallbackTime: rawTime === undefined || time !== toStringValue(rawTime),
    };
  }

  return {
    enabled: normalizeBoolean(rawEnabled),
    time,
    usedFallbackTime: rawTime === undefined || time !== toStringValue(rawTime),
  };
}

export function normalizePendingFeedbackReservations(values: unknown[][] | undefined, targetDate: string) {
  const feedbackSentColumn = getReservationFeedbackSentColumn(values);

  return rowsToObjects(values).flatMap((item) => {
    const rowIndex = Number(item.__ROW_INDEX__);
    const idReserva = toStringValue(pickValue(item, ['ID_RESERVA', 'ID RESERVA', 'id_reserva', '0']));
    const fecha = normalizeDateKey(pickValue(item, ['FECHA', 'fecha', '1']));
    const hora = toStringValue(pickValue(item, ['HORA', 'hora', '2']));
    const nombre = toStringValue(pickValue(item, ['NOMBRE', 'nombre', '3']));
    const telefono = normalizePhone(pickValue(item, ['TELEFONO', 'teléfono', 'telefono', '4']));
    const personas = toNumberValue(pickValue(item, ['PAX', 'pax', 'personas', '5']));
    const rawIdioma = pickValue(item, ['IDIOMA', 'idioma', '6']);
    const idioma = normalizeLanguage(rawIdioma);
    const normalizedIdioma = normalizeKey(rawIdioma);
    const languageFallback = !['es', 'en', 'eng', 'english', 'ingles'].includes(normalizedIdioma);
    const estado = toStringValue(pickValue(item, ['ESTADO', 'estado', '8'])).toUpperCase();
    const llego = normalizeBoolean(pickValue(item, ['LLEGO', 'llego', '11']));
    const feedbackEnviado = normalizeBoolean(pickValue(item, ['FEEDBACK_ENVIADO', 'FEEDBACK ENVIADO', 'feedback_enviado', '12']));

    if (
      !idReserva
      || fecha !== targetDate
      || estado !== 'CONFIRMADA'
      || !telefono
      || feedbackEnviado
      || !llego
    ) {
      return [];
    }

    return [{
      rowNumber: rowIndex + 1,
      idReserva,
      fecha,
      hora,
      nombre,
      telefono,
      personas,
      idioma,
      languageFallback,
      feedbackEnviadoColumn: feedbackSentColumn,
    }];
  });
}
