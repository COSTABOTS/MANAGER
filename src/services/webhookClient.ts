export interface WebhookResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  skipped?: boolean;
}

export async function sendWebhook<T = unknown>(webhookUrl: string | undefined, payload: unknown): Promise<WebhookResult<T>> {
  if (!webhookUrl?.trim()) {
    return {
      success: false,
      skipped: true,
      error: 'Webhook no configurado',
    };
  }

  try {
    const response = await fetch(webhookUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
      };
    }

    const data = (await response.json().catch(() => ({ ok: true }))) as T;
    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}
