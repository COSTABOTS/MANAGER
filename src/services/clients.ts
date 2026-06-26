import { invokeManagerApi } from './managerApiClient';

export interface ManagedClient {
  client_id: string;
  rest_name: string;
  logo_url?: string;
  primary_color?: string;
  sheet_id?: string;
  status?: string;
  plan?: string;
  expires_at?: string;
  is_demo?: boolean;
}

export async function loadManagedClientsWithManagerApi() {
  const response = await invokeManagerApi<{
    ok?: boolean;
    clients?: ManagedClient[];
    code?: string;
    message?: string;
  }>({
    action: 'clients.list',
  });

  if (response?.ok === false) {
    throw new Error(response.code || response.message || 'manager-api clients.list no devolvio ok=true');
  }

  return Array.isArray(response.clients) ? response.clients : [];
}
