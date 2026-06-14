export const PUBLIC_FEEDBACK_CONFIG_WEBHOOK_URL = 'https://hook.eu1.make.com/bwzfk1ranwtrky4kglamvofrmb76gbjp';

export type FeedbackSubmitState = 'idle' | 'sending' | 'success' | 'error';

export interface SubmitFeedbackPayload {
  id_reserva: string;
  puntuacion: number;
  puntuacion_texto: string;
  comentario: string;
  timestamp: string;
}

export async function submitFeedback(payload: SubmitFeedbackPayload, webhookUrl: string) {
  const targetUrl = webhookUrl.trim();

  if (!targetUrl) {
    throw new Error('Feedback webhook no configurado');
  }

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Feedback request failed with status ${response.status}`);
  }

  return { success: true, skipped: false };
}
