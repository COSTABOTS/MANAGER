const DETAILS_URL =
  'https://tbmkbzpdixoeucvvofjp.supabase.co/functions/v1/public-api/feedback/details';

const SUBMIT_URL =
  'https://tbmkbzpdixoeucvvofjp.supabase.co/functions/v1/public-api/feedback/submit';

const CLIENT_ID = 'CB-SAFARI-001';
const PUBLIC_TOKEN = '86511e4595e94c31a179354692be32e1';

export type FeedbackSubmitState = 'idle' | 'sending' | 'success' | 'already_submitted' | 'error';

export interface SubmitFeedbackPayload {
  id_reserva: string;
  puntuacion: number;
  puntuacion_texto: string;
  comentario: string;
  lang?: 'es' | 'en';
  timestamp: string;
}

export interface PublicFeedbackDetailsResponse {
  ok?: boolean;
  encontrada?: boolean;
  already_submitted?: boolean;
  branding?: Record<string, unknown>;
  review_links?: Record<string, unknown>;
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get('Content-Type') ?? '';
  const rawText = await response.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    if (rawText.trim()) {
      console.warn('[Safari Manager] Respuesta publica de feedback no JSON', {
        status: response.status,
        contentType,
      });
    }
    return null;
  }

  if (!rawText.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    console.warn('[Safari Manager] Respuesta publica de feedback JSON invalida', {
      status: response.status,
      contentType,
    });
    return null;
  }
}

export async function loadPublicFeedbackDetails(idReserva: string) {
  const response = await fetch(DETAILS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      public_token: PUBLIC_TOKEN,
      id_reserva: idReserva,
    }),
  });

  if (!response.ok) {
    throw new Error(`Feedback details request failed with status ${response.status}`);
  }

  return readJsonResponse<PublicFeedbackDetailsResponse>(response);
}

export async function submitFeedback(payload: SubmitFeedbackPayload) {
  const response = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      public_token: PUBLIC_TOKEN,
      ...payload,
    }),
  });

  const data = await readJsonResponse<Record<string, unknown>>(response);
  if (data?.already_submitted === true) {
    return { success: false, skipped: true, alreadySubmitted: true };
  }

  if (!response.ok || !data) {
    throw new Error(`Feedback request failed with status ${response.status}`);
  }

  if (data.ok !== true) {
    throw new Error(String(data.error ?? data.code ?? 'Feedback request failed'));
  }

  return {
    success: true,
    skipped: false,
    alreadySubmitted: false,
    positive: data.positive === true,
  };
}
