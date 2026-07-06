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

export async function saveClientBrandingWithManagerApi(primaryColor: string, logoUrl: string): Promise<ClientBrandingUpdateResult> {
  let response: {
    ok?: boolean;
    code?: string;
    message?: string;
    client?: ClientBrandingUpdateResult['client'];
  };

  try {
    response = await invokeManagerApi<typeof response>({
      action: 'client.branding.update',
      branding: {
        primary_color: primaryColor,
        logo_url: logoUrl,
      },
    });
  } catch (error) {
    console.warn('[BRANDING] manager-api save failed, using Supabase fallback', error);
    const clientId = getActiveManagerClientId();
    if (!clientId) {
      throw error;
    }

    const { data, error: supabaseError } = await supabase
      .from('CLIENTES')
      .update({ primary_color: primaryColor, logo_url: logoUrl })
      .eq('client_id', clientId)
      .select('client_id, rest_name, primary_color, logo_url, sheet_id, status, plan, expires_at, is_demo')
      .single();

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
