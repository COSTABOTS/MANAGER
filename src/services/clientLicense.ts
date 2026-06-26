import { invokeManagerApi } from './managerApiClient';
import { getActiveManagerClientId } from './managerApiClient';
import { supabase } from '../lib/supabaseClient';
import type { ClientLicense, ClientLicensePlan, ClientLicenseStatus } from '../types';

function normalizeStatus(value: unknown): ClientLicenseStatus {
  const status = String(value ?? '').trim().toUpperCase();
  return status === 'TRIAL' || status === 'SUSPENDED' || status === 'EXPIRED' ? status : 'ACTIVE';
}

function normalizePlan(value: unknown): ClientLicensePlan {
  return String(value ?? '').trim().toUpperCase() === 'PRO' ? 'PRO' : 'DEMO';
}

export interface ClientLicenseUpdateResult {
  license: ClientLicense;
  client: {
    client_id: string;
    rest_name?: string;
    status?: string;
    plan?: string;
    expires_at?: string;
    sheet_id?: string;
  };
}

export async function saveClientLicenseWithManagerApi(license: ClientLicense): Promise<ClientLicense> {
  let response: {
    ok?: boolean;
    code?: string;
    message?: string;
    license?: {
      status?: unknown;
      plan?: unknown;
      expires_at?: unknown;
      expiresAt?: unknown;
    };
  };

  try {
    response = await invokeManagerApi<typeof response>({
      action: 'client.license.update',
      license: {
        status: license.status,
        plan: license.plan,
        expires_at: license.expiresAt || null,
      },
    });
  } catch (error) {
    console.warn('[LICENSE] manager-api save failed, using emergency Supabase fallback', error);
    const clientId = getActiveManagerClientId();
    if (!clientId) {
      throw error;
    }

    const { data, error: supabaseError } = await supabase
      .from('CLIENTES')
      .update({
        status: license.status,
        plan: license.plan,
        expires_at: license.expiresAt || null,
      })
      .eq('client_id', clientId)
      .select('client_id, rest_name, status, plan, expires_at, sheet_id')
      .single();

    if (supabaseError || !data) {
      throw supabaseError ?? error;
    }

    response = {
      ok: true,
      license: data,
    };
  }

  if (response?.ok === false) {
    throw new Error(response?.code || response?.message || 'manager-api client.license.update no devolvio ok=true');
  }

  const savedLicense = response.license ?? {};
  return {
    status: normalizeStatus(savedLicense.status ?? license.status),
    plan: normalizePlan(savedLicense.plan ?? license.plan),
    expiresAt: String(savedLicense.expires_at ?? savedLicense.expiresAt ?? license.expiresAt ?? ''),
  };
}
