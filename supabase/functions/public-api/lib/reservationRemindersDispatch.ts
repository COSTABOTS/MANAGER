import type { PublicLanguage } from './normalization.ts';
import {
  normalizeBoolean,
  normalizeDateKey,
  normalizeKey,
  normalizeLanguage,
  normalizePhone,
  normalizeService,
  normalizeTime,
  pickValue,
  rowsToObjects,
  toNumberValue,
  toStringValue,
} from './normalization.ts';
import { columnNumberToLetter } from './feedback.ts';

export interface PreDinnerMessageConfig {
  enabled: boolean;
  minutes: number;
  usedFallbackMinutes: boolean;
}

export interface ReminderClock {
  date: string;
  time: string;
  minuteKey: number;
}

export interface PendingReservationReminder {
  rowNumber: number;
  idReserva: string;
  fecha: string;
  hora: string;
  nombre: string;
  telefono: string;
  personas: number;
  idioma: PublicLanguage;
  languageFallback: boolean;
  precenaEnviadoColumn: string;
}

export interface ReminderSkipStats {
  lateCreation: number;
  alreadySent: number;
  balinesa: number;
}

export type ReservationReminderDebugLogger = (entry: {
  id_reserva: string;
  fecha: string;
  hora: string;
  scheduled_send_time: string;
  estado: string;
  servicio: string;
  telefono_presente: boolean;
  precena_enviado: boolean;
  eligible: boolean;
  discard_reason: string;
}) => void;

const DEFAULT_PRE_DINNER_MINUTES = 120;
const MIN_PRE_DINNER_MINUTES = 15;
const MAX_PRE_DINNER_MINUTES = 1440;
const DISPATCH_WINDOW_MINUTES = 15;

function getMadridParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return {
    date: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
    time: `${getPart('hour')}:${getPart('minute')}`,
  };
}

function dateTimeToMinuteKey(date: string, time: string) {
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);

  if (!dateMatch || !timeMatch) {
    return NaN;
  }

  return Math.floor(Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  ) / 60000);
}

function minuteKeyToDebugDateTime(minuteKey: number) {
  if (!Number.isFinite(minuteKey)) {
    return '';
  }

  return new Date(minuteKey * 60000).toISOString().slice(0, 16).replace('T', ' ');
}

function normalizeInteger(value: unknown, fallback: number) {
  const rawValue = toStringValue(value);
  const parsed = Number(rawValue);

  if (!/^\d+$/.test(rawValue) || !Number.isInteger(parsed) || parsed < MIN_PRE_DINNER_MINUTES || parsed > MAX_PRE_DINNER_MINUTES) {
    return fallback;
  }

  return parsed;
}

function parseManualClock(body: Record<string, unknown>): ReminderClock | null {
  const targetDateTime = toStringValue(body.target_datetime ?? body.targetDateTime);
  const dateTimeMatch = targetDateTime.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2})(?::\d{2})?/);
  if (dateTimeMatch) {
    const date = normalizeDateKey(dateTimeMatch[1]);
    const time = normalizeTime(dateTimeMatch[2]);
    return { date, time, minuteKey: dateTimeToMinuteKey(date, time) };
  }

  const targetDate = normalizeDateKey(body.target_date ?? body.targetDate);
  const currentTime = normalizeTime(body.current_time ?? body.currentTime);
  if (targetDate && currentTime) {
    return { date: targetDate, time: currentTime, minuteKey: dateTimeToMinuteKey(targetDate, currentTime) };
  }

  return null;
}

function parseCreatedAtMinuteKey(value: unknown) {
  const rawValue = toStringValue(value);
  if (!rawValue) {
    return NaN;
  }

  const isoDate = new Date(rawValue);
  if (!Number.isNaN(isoDate.getTime())) {
    const madrid = getMadridParts(isoDate);
    return dateTimeToMinuteKey(madrid.date, madrid.time);
  }

  const dateTimeMatch = rawValue.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})[T\s]+(\d{1,2}:\d{2})(?::\d{2})?/);
  if (!dateTimeMatch) {
    return NaN;
  }

  const date = normalizeDateKey(dateTimeMatch[1]);
  const time = normalizeTime(dateTimeMatch[2]);
  return dateTimeToMinuteKey(date, time);
}

function getSettingsMap(values: unknown[][] | undefined) {
  return rowsToObjects(values).reduce<Record<string, string>>((items, item) => {
    const key = toStringValue(pickValue(item, ['VARIABLE', 'variable', 'KEY', 'key', '0'])).toUpperCase();
    const value = toStringValue(pickValue(item, ['VALUE', 'value', 'VALOR', 'valor', '1']));

    if (key) {
      items[key] = value;
    }

    return items;
  }, {});
}

export function getCurrentMadridClock(body: Record<string, unknown> = {}): ReminderClock {
  const manualClock = parseManualClock(body);
  if (manualClock && Number.isFinite(manualClock.minuteKey)) {
    return manualClock;
  }

  const madrid = getMadridParts();
  return {
    ...madrid,
    minuteKey: dateTimeToMinuteKey(madrid.date, madrid.time),
  };
}

export function getPreDinnerMessageConfig(values: unknown[][] | undefined): PreDinnerMessageConfig {
  const settings = getSettingsMap(values);
  const rawEnabled = settings.WHATSAPP_PRE_DINNER_ENABLED;
  const rawMinutes = settings.WHATSAPP_PRE_DINNER_MINUTES;
  const minutes = normalizeInteger(rawMinutes, DEFAULT_PRE_DINNER_MINUTES);

  return {
    enabled: normalizeBoolean(rawEnabled),
    minutes,
    usedFallbackMinutes: rawMinutes === undefined || String(minutes) !== toStringValue(rawMinutes),
  };
}

export function getReservationPreDinnerSentColumn(values: unknown[][] | undefined) {
  const headers = values?.[0]?.map((header) => toStringValue(header).toUpperCase()) ?? [];
  const index = headers.findIndex((header) => ['PRECENA_ENVIADO', 'PRE_CENA_ENVIADO', 'PRE DINNER SENT'].includes(header));
  return columnNumberToLetter((index >= 0 ? index : 19) + 1);
}

export function normalizePendingReservationReminders(
  values: unknown[][] | undefined,
  clock: ReminderClock,
  minutesBeforeReservation: number,
  force: boolean,
  skipStats: ReminderSkipStats,
  debugLogger?: ReservationReminderDebugLogger,
) {
  const preDinnerSentColumn = getReservationPreDinnerSentColumn(values);

  return rowsToObjects(values).flatMap((item) => {
    const rowIndex = Number(item.__ROW_INDEX__);
    const idReserva = toStringValue(pickValue(item, ['ID_RESERVA', 'ID RESERVA', 'id_reserva', '0']));
    const fecha = normalizeDateKey(pickValue(item, ['FECHA', 'fecha', '1']));
    const hora = normalizeTime(pickValue(item, ['HORA', 'hora', '2']));
    const nombre = toStringValue(pickValue(item, ['NOMBRE', 'nombre', '3']));
    const telefono = normalizePhone(pickValue(item, ['TELEFONO', 'telefono', '4']));
    const personas = toNumberValue(pickValue(item, ['PAX', 'pax', 'personas', '5']));
    const rawIdioma = pickValue(item, ['IDIOMA', 'idioma', '6']);
    const idioma = normalizeLanguage(rawIdioma);
    const normalizedIdioma = normalizeKey(rawIdioma);
    const languageFallback = !['es', 'en', 'eng', 'english', 'ingles'].includes(normalizedIdioma);
    const estado = toStringValue(pickValue(item, ['ESTADO', 'estado', '8'])).toUpperCase();
    const servicio = normalizeService(pickValue(item, ['SERVICIO', 'servicio', 'service', '16']));
    const preDinnerSent = normalizeBoolean(pickValue(item, ['PRECENA_ENVIADO', 'PRE_CENA_ENVIADO', 'precena_enviado', '19']));
    const reservationMinuteKey = dateTimeToMinuteKey(fecha, hora);
    const reminderTargetMinuteKey = reservationMinuteKey - minutesBeforeReservation;
    const logReservation = (eligible: boolean, discardReason: string) => {
      debugLogger?.({
        id_reserva: idReserva,
        fecha,
        hora,
        scheduled_send_time: minuteKeyToDebugDateTime(reminderTargetMinuteKey),
        estado,
        servicio,
        telefono_presente: Boolean(telefono),
        precena_enviado: preDinnerSent,
        eligible,
        discard_reason: discardReason,
      });
    };

    if (!idReserva) {
      logReservation(false, 'MISSING_ID_RESERVA');
      return [];
    }

    if (fecha !== clock.date) {
      logReservation(false, 'DATE_MISMATCH');
      return [];
    }

    if (estado !== 'CONFIRMADA') {
      logReservation(false, 'STATUS_NOT_CONFIRMED');
      return [];
    }

    if (!telefono) {
      logReservation(false, 'PHONE_MISSING');
      return [];
    }

    if (!hora) {
      logReservation(false, 'TIME_MISSING');
      return [];
    }

    if (preDinnerSent) {
      skipStats.alreadySent += 1;
      logReservation(false, 'ALREADY_SENT');
      return [];
    }

    if (servicio === 'BALINESA') {
      skipStats.balinesa += 1;
      logReservation(false, 'BALINESA_SKIPPED');
      return [];
    }

    if (!force) {
      if (!Number.isFinite(reservationMinuteKey) || clock.minuteKey >= reservationMinuteKey) {
        logReservation(false, Number.isFinite(reservationMinuteKey) ? 'RESERVATION_TIME_PASSED' : 'INVALID_RESERVATION_TIME');
        return [];
      }

      const createdAtMinuteKey = parseCreatedAtMinuteKey(pickValue(item, ['CREATED_AT', 'created_at', '14']));
      if (Number.isFinite(createdAtMinuteKey) && createdAtMinuteKey > reminderTargetMinuteKey + DISPATCH_WINDOW_MINUTES) {
        skipStats.lateCreation += 1;
        logReservation(false, 'CREATED_AFTER_DISPATCH_WINDOW');
        return [];
      }

      if (clock.minuteKey < reminderTargetMinuteKey || clock.minuteKey >= reminderTargetMinuteKey + DISPATCH_WINDOW_MINUTES) {
        logReservation(false, 'OUTSIDE_DISPATCH_WINDOW');
        return [];
      }
    }

    logReservation(true, '');

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
      precenaEnviadoColumn: preDinnerSentColumn,
    }];
  });
}
