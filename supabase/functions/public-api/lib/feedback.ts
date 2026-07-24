import {
  normalizeLanguage,
  normalizePhone,
  normalizeService,
  pickValue,
  rowsToObjects,
  toNumberValue,
  toStringValue,
} from './normalization.ts';

export interface PublicFeedbackReservation {
  rowNumber: number;
  idReserva: string;
  fecha: string;
  hora: string;
  nombre: string;
  telefono: string;
  personas: number;
  idioma: 'es' | 'en';
  habitacion: string;
  estado: string;
  servicio: string;
  feedbackEnviado: boolean;
  feedbackEnviadoColumn: string;
}

export interface PublicFeedbackRow {
  rowNumber: number;
  idReserva: string;
}

export interface NormalizedFeedbackSubmit {
  idReserva: string;
  puntuacion: number;
  puntuacionTexto: string;
  comentario: string;
  idioma: 'es' | 'en';
  timestamp: string;
}

function normalizeBooleanValue(value: unknown) {
  return ['true', '1', 'si', 'sí', 'yes', 'y', 'on'].includes(toStringValue(value).toLowerCase());
}

export function columnNumberToLetter(columnNumber: number) {
  let number = columnNumber;
  let column = '';

  while (number > 0) {
    const remainder = (number - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    number = Math.floor((number - 1) / 26);
  }

  return column;
}

function getHeaderIndex(values: unknown[][] | undefined, candidates: string[], fallback: number) {
  const headers = values?.[0]?.map((header) => toStringValue(header).toUpperCase()) ?? [];
  const index = headers.findIndex((header) => candidates.includes(header));
  return index >= 0 ? index : fallback;
}

export function getReservationFeedbackSentColumn(values: unknown[][] | undefined) {
  const index = getHeaderIndex(values, ['FEEDBACK_ENVIADO', 'FEEDBACK ENVIADO'], 12);
  return columnNumberToLetter(index + 1);
}

export function normalizeFeedbackReservations(values: unknown[][] | undefined): PublicFeedbackReservation[] {
  const feedbackSentColumn = getReservationFeedbackSentColumn(values);

  return rowsToObjects(values).flatMap((item) => {
    const rowIndex = Number(item.__ROW_INDEX__);
    const idReserva = toStringValue(pickValue(item, ['ID_RESERVA', 'ID RESERVA', 'id_reserva', '0']));
    const fecha = toStringValue(pickValue(item, ['FECHA', 'fecha', '1']));
    const hora = toStringValue(pickValue(item, ['HORA', 'hora', '2']));
    const nombre = toStringValue(pickValue(item, ['NOMBRE', 'nombre', '3']));
    const telefono = toStringValue(pickValue(item, ['TELEFONO', 'teléfono', 'telefono', '4']));
    const personas = toNumberValue(pickValue(item, ['PAX', 'pax', 'personas', '5']));
    const idioma = normalizeLanguage(pickValue(item, ['IDIOMA', 'idioma', '6']));
    const estado = toStringValue(pickValue(item, ['ESTADO', 'estado', '8'])).toUpperCase();
    const feedbackEnviado = normalizeBooleanValue(pickValue(item, ['FEEDBACK_ENVIADO', 'FEEDBACK ENVIADO', 'feedback_enviado', '12']));
    const habitacion = toStringValue(pickValue(item, ['HABITACION', 'habitación', 'habitacion', '13']));
    const servicio = normalizeService(pickValue(item, ['SERVICIO', 'servicio', 'service', '16']));

    if (!idReserva) {
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
      habitacion,
      estado,
      servicio,
      feedbackEnviado,
      feedbackEnviadoColumn: feedbackSentColumn,
    }];
  });
}

export function normalizeFeedbackRows(values: unknown[][] | undefined): PublicFeedbackRow[] {
  return rowsToObjects(values).flatMap((item) => {
    const rowIndex = Number(item.__ROW_INDEX__);
    const idReserva = toStringValue(pickValue(item, ['ID_RESERVA', 'ID RESERVA', 'id_reserva', '7']));

    if (!idReserva) {
      return [];
    }

    return [{
      rowNumber: rowIndex + 1,
      idReserva,
    }];
  });
}

export function findFeedbackReservation(rows: PublicFeedbackReservation[], idReserva: unknown) {
  const targetId = toStringValue(idReserva);
  return rows.find((row) => row.idReserva === targetId) ?? null;
}

export function hasFeedbackForReservation(rows: PublicFeedbackRow[], idReserva: unknown) {
  const targetId = toStringValue(idReserva);
  return rows.some((row) => row.idReserva === targetId);
}

export function normalizeFeedbackSubmit(body: Record<string, unknown>, reservation?: PublicFeedbackReservation | null) {
  const idReserva = toStringValue(body.id_reserva ?? body.idReserva ?? body.ID_RESERVA);
  const rawRating = body.puntuacion ?? body.rating ?? body.stars;
  const rating = Number(toStringValue(rawRating).replace(',', '.'));
  const puntuacion = Number.isInteger(rating) ? rating : 0;
  const comentario = toStringValue(body.comentario ?? body.comment);
  const idioma = normalizeLanguage(body.lang ?? body.idioma ?? reservation?.idioma);
  const timestamp = toStringValue(body.timestamp) || new Date().toISOString();
  const providedText = toStringValue(body.puntuacion_texto ?? body.ratingText);
  const puntuacionTexto = providedText || '⭐'.repeat(Math.min(5, Math.max(1, puntuacion)));

  return {
    normalized: idReserva && puntuacion >= 1 && puntuacion <= 5
      ? {
        idReserva,
        puntuacion,
        puntuacionTexto,
        comentario,
        idioma,
        timestamp,
      } satisfies NormalizedFeedbackSubmit
      : null,
    missingFields: [
      !idReserva ? 'id_reserva' : '',
    ].filter(Boolean),
    invalidFields: [
      puntuacion < 1 || puntuacion > 5 ? 'puntuacion' : '',
    ].filter(Boolean),
  };
}

export function formatFeedbackDate(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(date);
}

export function normalizeSettings(values: unknown[][] | undefined) {
  return rowsToObjects(values).reduce<Record<string, string>>((settings, item) => {
    const key = toStringValue(pickValue(item, ['VARIABLE', 'KEY', 'variable', 'key', '0'])).toUpperCase();
    const value = toStringValue(pickValue(item, ['VALUE', 'VALOR', 'value', 'valor', '1']));

    if (key) {
      settings[key] = value;
    }

    return settings;
  }, {});
}

export function getFeedbackAlertPhone(settings: Record<string, string>) {
  return normalizePhone(settings.FEEDBACK_ALERT_PHONE);
}

export function buildFeedbackAppendRow(
  reservation: PublicFeedbackReservation,
  feedback: NormalizedFeedbackSubmit,
) {
  return [
    formatFeedbackDate(),
    feedback.puntuacionTexto,
    feedback.comentario,
    reservation.telefono,
    reservation.nombre,
    reservation.habitacion,
    feedback.timestamp,
    feedback.idReserva,
  ];
}
