export type WebhookValidationResult =
  | { valid: true }
  | { valid: false; message: string };

export function requireWebhookFields(payload: Record<string, unknown>, fields: string[], label: string): WebhookValidationResult {
  const missingField = fields.find((field) => {
    const value = payload[field];
    return value === undefined || value === null || String(value).trim() === '';
  });

  if (missingField) {
    return {
      valid: false,
      message: `Faltan datos para sincronizar ${label}`,
    };
  }

  return { valid: true };
}

export function requireNameOrRoom(payload: { nombre?: unknown; habitacion?: unknown }, label: string): WebhookValidationResult {
  if (String(payload.nombre ?? '').trim() || String(payload.habitacion ?? '').trim()) {
    return { valid: true };
  }

  return {
    valid: false,
    message: `Faltan nombre o habitacion para sincronizar ${label}`,
  };
}
