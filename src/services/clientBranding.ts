import { supabase } from '../lib/supabaseClient';
import { getActiveManagerClientId, invokeManagerApi } from './managerApiClient';

export interface ClientBrandingUpdateResult {
  client: {
    client_id: string;
    rest_name?: string;
    primary_color?: string;
    logo_url?: string;
    sheet_id?: string;
    status?: string;
    plan?: string;
    expires_at?: string;
    is_demo?: boolean;
  };
}

export async function saveClientBrandingWithManagerApi(primaryColor: string, logoUrl: string, restName?: string): Promise<ClientBrandingUpdateResult> {
  let response: {
    ok?: boolean;
    code?: string;
    message?: string;
    client?: ClientBrandingUpdateResult['client'];
  };
  const brandingPayload: { primary_color: string; logo_url: string; rest_name?: string } = {
    primary_color: primaryColor,
    logo_url: logoUrl,
  };
  if (restName !== undefined) {
    brandingPayload.rest_name = restName;
  }

  try {
    console.log('[BRANDING] manager-api payload', {
      action: 'client.branding.update',
      client_id: getActiveManagerClientId(),
      fields: {
        ...(restName !== undefined ? { rest_name: restName } : {}),
        primary_color: primaryColor,
        logo_url: logoUrl,
      },
    });
    response = await invokeManagerApi<typeof response>({
      action: 'client.branding.update',
      branding: brandingPayload,
    });
    console.log('[BRANDING] manager-api response', response);
  } catch (error) {
    console.warn('[BRANDING] manager-api save failed, using Supabase fallback', error);
    const clientId = getActiveManagerClientId();
    if (!clientId) {
      throw error;
    }

    const { data, error: supabaseError } = await supabase
      .from('CLIENTES')
      .update(brandingPayload)
      .eq('client_id', clientId)
      .select('client_id, rest_name, primary_color, logo_url, sheet_id, status, plan, expires_at, is_demo')
      .single();

    console.log('[BRANDING] Supabase fallback response', {
      client_id: clientId,
      sent: brandingPayload,
      data,
      error: supabaseError,
    });

    if (supabaseError || !data) {
      throw supabaseError ?? error;
    }

    response = {
      ok: true,
      client: data,
    };
  }

  if (response?.ok === false || !response?.client?.client_id) {
    throw new Error(response?.code || response?.message || 'No se pudo guardar branding en CLIENTES');
  }

  return {
    client: response.client,
  };
}

export async function saveClientPrimaryColorWithManagerApi(primaryColor: string): Promise<ClientBrandingUpdateResult> {
  return saveClientBrandingWithManagerApi(primaryColor, '');
}
