import { supabase } from '../lib/supabaseClient';

type FeedbackRow = Record<string, unknown>;

interface FeedbacksResponse {
  success?: boolean;
  feedbacks?: FeedbackRow[] | FeedbackRow;
  data?: FeedbackRow[] | FeedbackRow;
  items?: FeedbackRow[] | FeedbackRow;
}

export interface Feedback {
  id: string;
  date: string;
  client: string;
  room: string;
  comment: string;
  rating: number;
  timestamp: string;
}

function unwrapValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => item !== undefined && item !== null && item !== '') ?? '';
  }

  return value;
}

function pick(row: FeedbackRow | undefined, keys: string[]) {
  for (const key of keys) {
    const value = unwrapValue(row?.[key]);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return '';
}

function toStringValue(value: unknown) {
  const unwrappedValue = unwrapValue(value);
  return unwrappedValue === undefined || unwrappedValue === null ? '' : String(unwrappedValue).trim();
}

function toRatingValue(value: unknown) {
  const rawValue = toStringValue(value);
  const starCount = [...rawValue].filter((character) => character === '⭐').length;
  if (starCount > 0) {
    return Math.min(5, Math.max(1, starCount));
  }

  const rating = Number(rawValue.replace(',', '.'));
  return Number.isFinite(rating) ? Math.min(5, Math.max(0, Math.round(rating))) : 0;
}

function normalizeRows(value: FeedbackRow[] | FeedbackRow | undefined) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getFeedbackRows(data: FeedbacksResponse | FeedbackRow[]) {
  if (Array.isArray(data)) {
    return data;
  }

  return normalizeRows(data.feedbacks ?? data.data ?? data.items);
}

export function normalizeFeedback(row: FeedbackRow, index: number): Feedback | null {
  const date = toStringValue(pick(row, ['fecha', 'FECHA', 'date', 'DATE', '0']));
  const rating = toRatingValue(pick(row, ['puntuacion', 'PUNTUACION', 'rating', 'RATING', '1']));
  const comment = toStringValue(pick(row, ['comentario', 'COMENTARIO', 'comment', 'COMMENT', '2']));
  const client = toStringValue(pick(row, ['cliente', 'CLIENTE', 'nombre', 'NOMBRE', 'client', 'name', '4']));
  const room = toStringValue(pick(row, ['habitacion', 'HABITACION', 'room', 'ROOM', '5']));
  const timestamp = toStringValue(pick(row, ['timestamp', 'TIMESTAMP', '6']));

  if (!date && !comment && !client && rating === 0) {
    return null;
  }

  return {
    id: timestamp || `${date}-${client}-${index}`,
    date,
    client,
    room,
    comment,
    rating,
    timestamp,
  };
}

export async function loadFeedbacks(webhookUrl: string, sheetId?: string): Promise<Feedback[]> {
  if (!webhookUrl.trim()) {
    throw new Error('Webhook de feedbacks no configurado');
  }

  const response = await fetch(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accion: 'leer_feedbacks',
      action: 'GET_FEEDBACKS',
      sheet_id: sheetId ?? '',
      sheet: 'FEEDBACKS',
      hoja: 'FEEDBACKS',
      sheet_name: 'FEEDBACKS',
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudieron cargar feedbacks (${response.status})`);
  }

  const data = (await response.json()) as FeedbacksResponse | FeedbackRow[];
  console.log('Feedbacks raw response', data);

  if (!Array.isArray(data) && data.success === false) {
    throw new Error('Respuesta de feedbacks no valida');
  }

  const rows = getFeedbackRows(data);
  const normalizedFeedbacks = rows.flatMap((row, index) => {
    const feedback = normalizeFeedback(row, index);
    return feedback ? [feedback] : [];
  });

  console.log('Feedbacks normalized', normalizedFeedbacks);

  return normalizedFeedbacks;
}

export async function loadFeedbacksFromManagerApi(): Promise<Feedback[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;

  const { data, error } = await supabase.functions.invoke('manager-api', {
    body: { action: 'feedbacks.list' },
    headers: session?.access_token
      ? {
          Authorization: `Bearer ${session.access_token}`,
        }
      : undefined,
  });

  if (error) {
    throw error;
  }

  const response = data as { ok?: boolean; code?: string; message?: string; feedbacks?: FeedbackRow[] };
  if (!response?.ok) {
    throw new Error(response?.code || response?.message || 'manager-api feedbacks.list no devolvio ok=true');
  }

  const normalizedFeedbacks = (response.feedbacks ?? []).flatMap((row, index) => {
    const feedback = normalizeFeedback(row, index);
    return feedback ? [feedback] : [];
  });
  console.log('[DEMO][MANAGER_API] feedbacks received', normalizedFeedbacks.length);

  return normalizedFeedbacks;
}
