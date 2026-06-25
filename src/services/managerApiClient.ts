import { supabase } from '../lib/supabaseClient';
import { CLIENT_CONFIG_KEY } from './clientConfig';

export function getActiveManagerClientId() {
  try {
    const rawConfig = window.sessionStorage.getItem(CLIENT_CONFIG_KEY);
    if (!rawConfig) {
      return '';
    }

    const config = JSON.parse(rawConfig) as {
      client_id?: unknown;
      clientId?: unknown;
      effectiveClientId?: unknown;
      selectedClientId?: unknown;
    };
    return String(config.effectiveClientId ?? config.selectedClientId ?? config.client_id ?? config.clientId ?? '').trim();
  } catch {
    return '';
  }
}

export function getManagerClientDebugContext() {
  try {
    const rawConfig = window.sessionStorage.getItem(CLIENT_CONFIG_KEY);
    if (!rawConfig) {
      return {
        profileClientId: '',
        selectedClientId: '',
        effectiveClientId: '',
      };
    }

    const config = JSON.parse(rawConfig) as {
      client_id?: unknown;
      clientId?: unknown;
      profile_client_id?: unknown;
      authProfileClientId?: unknown;
      selectedClientId?: unknown;
      effectiveClientId?: unknown;
    };
    const effectiveClientId = String(config.effectiveClientId ?? config.selectedClientId ?? config.client_id ?? config.clientId ?? '').trim();

    return {
      profileClientId: String(config.authProfileClientId ?? config.profile_client_id ?? '').trim(),
      selectedClientId: String(config.selectedClientId ?? config.client_id ?? config.clientId ?? '').trim(),
      effectiveClientId,
    };
  } catch {
    return {
      profileClientId: '',
      selectedClientId: '',
      effectiveClientId: '',
    };
  }
}

export function buildManagerApiBody<T extends Record<string, unknown>>(body: T): T & { client_id?: string; effective_client_id?: string } {
  const context = getManagerClientDebugContext();
  console.log('[MANAGER_API][CLIENT_CONTEXT]', {
    action: body.action,
    profileClientId: context.profileClientId,
    selectedClientId: context.selectedClientId,
    effectiveClientId: context.effectiveClientId,
  });
  console.log('[API DEBUG]', body.action, context.effectiveClientId);

  return context.effectiveClientId
    ? { ...body, client_id: context.effectiveClientId, effective_client_id: context.effectiveClientId }
    : body;
}

async function readFunctionsErrorBody(error: unknown) {
  const context = (error as { context?: unknown })?.context;
  const response = context instanceof Response
    ? context
    : context && typeof context === 'object' && 'text' in context
      ? context as Response
      : null;

  if (!response) {
    return {
      status: (context as { status?: number } | undefined)?.status ?? null,
      bodyText: '',
      bodyJson: null as unknown,
    };
  }

  const readableResponse = typeof response.clone === 'function' ? response.clone() : response;
  const bodyText = await readableResponse.text().catch(() => '');
  let bodyJson: unknown = null;

  if (bodyText) {
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = null;
    }
  }

  return {
    status: response.status,
    bodyText,
    bodyJson,
  };
}

export async function invokeManagerApi<TResponse = unknown, TBody extends Record<string, unknown> = Record<string, unknown>>(body: TBody): Promise<TResponse> {
  const requestBody = buildManagerApiBody(body);
  const context = getManagerClientDebugContext();
  let { data: sessionData } = await supabase.auth.getSession();
  let session = sessionData.session;

  if (!session?.access_token) {
    const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError) {
      sessionData = refreshedData;
      session = sessionData.session;
    }
  }

  console.log('[MANAGER_API][AUTH]', {
    action: requestBody.action,
    effectiveClientId: context.effectiveClientId,
    sessionExists: Boolean(session),
    tokenExists: Boolean(session?.access_token),
  });

  const { data, error } = await supabase.functions.invoke('manager-api', {
    body: requestBody,
    headers: session?.access_token
      ? {
          Authorization: `Bearer ${session.access_token}`,
        }
      : undefined,
  });

  if (error) {
    const errorBody = await readFunctionsErrorBody(error);
    console.error('[MANAGER_API][ERROR_BODY]', {
      action: requestBody.action,
      effectiveClientId: context.effectiveClientId,
      status: errorBody.status,
      body: errorBody.bodyJson ?? errorBody.bodyText,
      message: error instanceof Error ? error.message : String(error),
      context: (error as { context?: unknown })?.context,
    });

    const errorPayload = errorBody.bodyJson as { code?: string; error?: string; message?: string } | null;
    throw new Error(errorPayload?.code || errorPayload?.error || errorPayload?.message || errorBody.bodyText || (error instanceof Error ? error.message : String(error)));
  }

  const responsePayload = data as { ok?: boolean; code?: string; error?: string; message?: string } | null;
  if (responsePayload?.ok === false) {
    console.error('[MANAGER_API][ERROR_BODY]', {
      action: requestBody.action,
      effectiveClientId: context.effectiveClientId,
      status: 200,
      body: responsePayload,
    });
  }

  return data as TResponse;
}
