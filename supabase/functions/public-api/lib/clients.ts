import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { errorResponse } from './responses.ts';
import { toStringValue } from './normalization.ts';

export type DbClient = ReturnType<typeof createClient>;

interface ValidatePublicClientOptions {
  missingFieldsError?: string;
  invalidClientError?: string;
  inactiveLicenseError?: string;
}

export async function validatePublicClient(request: Request, dbClient: DbClient, body: Record<string, unknown>, options: ValidatePublicClientOptions = {}) {
  const missingFieldsError = options.missingFieldsError ?? 'PUBLIC_AUTH_REQUIRED';
  const invalidClientError = options.invalidClientError ?? 'CLIENT_PUBLIC_AUTH_FAILED';
  const inactiveLicenseError = options.inactiveLicenseError ?? 'LICENSE_INACTIVE';
  const clientId = toStringValue(body.client_id ?? body.clientId);
  const publicToken = toStringValue(body.public_token ?? body.publicToken);

  if (!clientId || !publicToken) {
    return {
      error: errorResponse(request, missingFieldsError, 200, {
        required: ['client_id', 'public_token'],
      }),
    };
  }

  const { data: client, error: clientError } = await dbClient
    .from('CLIENTES')
    .select('client_id, rest_name, status, public_token, sheet_id, logo_url, primary_color, booking_url, public_url, bot_url, contact_phone')
    .eq('client_id', clientId)
    .eq('public_token', publicToken)
    .maybeSingle();

  if (clientError || !client) {
    console.warn('[PUBLIC_API][INVALID_CLIENT]', { clientId, hasPublicToken: Boolean(publicToken), error: clientError?.message });
    return { error: errorResponse(request, invalidClientError, 200) };
  }

  const clientStatus = toStringValue((client as Record<string, unknown>).status).toUpperCase() || 'ACTIVE';
  if (clientStatus === 'SUSPENDED' || clientStatus === 'EXPIRED') {
    return { error: errorResponse(request, inactiveLicenseError, 200) };
  }

  return {
    client: client as Record<string, unknown>,
    clientId,
    sheetId: toStringValue((client as Record<string, unknown>).sheet_id),
  };
}
