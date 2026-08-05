import type { ReservationRecord } from '../../_shared/reservation-store/types.ts';
import type { PublicCancellationReservation } from './cancellations.ts';
import type { PublicFeedbackReservation } from './feedback.ts';
import type { PendingFeedbackReservation } from './feedbackDispatch.ts';
import type { PendingReservationReminder, ReminderClock, ReminderSkipStats } from './reservationRemindersDispatch.ts';
import { normalizeDateKey, normalizeLanguage, normalizePhone, normalizeService, normalizeTime } from './normalization.ts';

export function toCancellationReservation(row: ReservationRecord): PublicCancellationReservation {
  return { rowNumber: 0, idReserva: row.id, nombre: row.name, fecha: row.date, hora: row.time,
    telefono: row.phone, personas: row.pax, idioma: normalizeLanguage(row.language), estado: row.status,
    servicio: normalizeService(row.service), paqueteBalinesa: row.balinesePackage, recurso: row.resource };
}

export function toFeedbackReservation(row: ReservationRecord): PublicFeedbackReservation {
  return { rowNumber: 0, idReserva: row.id, fecha: row.date, hora: row.time, nombre: row.name,
    telefono: row.phone, personas: row.pax, idioma: normalizeLanguage(row.language), habitacion: row.room,
    estado: row.status, servicio: normalizeService(row.service), feedbackEnviado: row.feedbackSent,
    feedbackEnviadoColumn: '' };
}

export function toConfirmationReservation(row: ReservationRecord) {
  return { rowNumber: 0, idReserva: row.id, fecha: row.date, hora: row.time, nombre: row.name,
    telefono: row.phone, pax: String(row.pax), idioma: row.language, peticionEspecial: row.specialRequest,
    estado: row.status, habitacion: row.room, servicio: normalizeService(row.service), paqueteBalinesa: row.balinesePackage };
}

function minuteKey(date: string, time: string) {
  const match = `${normalizeDateKey(date)}T${normalizeTime(time)}`.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return match ? Math.floor(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) / 60000) : NaN;
}

function createdMinuteKey(value: string | undefined) {
  if (!value) return NaN;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return NaN;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(parsed);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return minuteKey(`${part('year')}-${part('month')}-${part('day')}`, `${part('hour')}:${part('minute')}`);
}

export function selectSupabaseReminders(rows: ReservationRecord[], clock: ReminderClock, minutes: number, force: boolean, stats: ReminderSkipStats): PendingReservationReminder[] {
  return rows.flatMap((row) => {
    const phone = normalizePhone(row.phone);
    const service = normalizeService(row.service);
    if (!phone || row.status !== 'CONFIRMADA' || row.preDinnerSent) return [];
    if (service === 'BALINESA') { stats.balinese += 1; return []; }
    const target = minuteKey(row.date, row.time) - minutes;
    if (!force) {
      const created = createdMinuteKey(row.createdAt);
      if (Number.isFinite(created) && created > target + 15) { stats.lateCreation += 1; return []; }
      if (!Number.isFinite(target) || clock.minuteKey < target || clock.minuteKey >= target + 15) return [];
    }
    return [{ rowNumber: 0, idReserva: row.id, fecha: row.date, hora: row.time, nombre: row.name,
      telefono: phone, personas: row.pax, idioma: normalizeLanguage(row.language), languageFallback: false,
      precenaEnviadoColumn: '' }];
  });
}

export function selectSupabaseFeedbackInvitations(rows: ReservationRecord[]): PendingFeedbackReservation[] {
  return rows.flatMap((row) => {
    const phone = normalizePhone(row.phone);
    if (!phone || row.status !== 'CONFIRMADA' || !row.arrived || row.feedbackSent) return [];
    return [{ rowNumber: 0, idReserva: row.id, fecha: row.date, hora: row.time, nombre: row.name,
      telefono: phone, personas: row.pax, idioma: normalizeLanguage(row.language), languageFallback: false,
      feedbackEnviadoColumn: '' }];
  });
}
