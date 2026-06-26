import { invokeManagerApi } from './managerApiClient';
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

export async function saveClientLicenseWithManagerApi(license: ClientLicense): Promise<ClientLicenseUpdateResult> {
  const response = await invokeManagerApi<{
    ok?: boolean;
    code?: string;
    message?: string;
    client?: {
      client_id?: unknown;
      rest_name?: unknown;
      status?: unknown;
      plan?: unknown;
      expires_at?: unknown;
      sheet_id?: unknown;
    };
    license?: {
      status?: unknown;
      plan?: unknown;
      expires_at?: unknown;
      expiresAt?: unknown;
    };
  }>({
    action: 'client.license.update',
    license: {
      status: license.status,
      plan: license.plan,
      expires_at: license.expiresAt || null,
    },
  });

  if (response?.ok === false || !response?.client?.client_id) {
    throw new Error(response?.code || response?.message || 'manager-api client.license.update no devolvio cliente actualizado');
  }

  const savedLicense = response.license ?? {};
  const savedClient = response.client;
  return {
    license: {
      status: normalizeStatus(savedLicense.status ?? savedClient.status ?? license.status),
      plan: normalizePlan(savedLicense.plan ?? savedClient.plan ?? license.plan),
      expiresAt: String(savedLicense.expires_at ?? savedLicense.expiresAt ?? savedClient.expires_at ?? license.expiresAt ?? ''),
    },
    client: {
      client_id: String(savedClient.client_id ?? ''),
      rest_name: String(savedClient.rest_name ?? ''),
      status: normalizeStatus(savedClient.status ?? savedLicense.status ?? license.status),
      plan: normalizePlan(savedClient.plan ?? savedLicense.plan ?? license.plan),
      expires_at: String(savedClient.expires_at ?? savedLicense.expires_at ?? savedLicense.expiresAt ?? ''),
      sheet_id: String(savedClient.sheet_id ?? ''),
    },
  };
}
