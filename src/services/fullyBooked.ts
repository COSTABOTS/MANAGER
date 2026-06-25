import { invokeManagerApi } from './managerApiClient';

interface FullyBookedResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  fullyBooked?: boolean;
}

async function callFullyBooked(action: 'fullybooked.get' | 'fullybooked.set', payload: Record<string, unknown>) {
  const data = await invokeManagerApi<FullyBookedResponse>({
    action,
    ...payload,
  });

  const response = data as FullyBookedResponse;
  if (!response?.ok) {
    throw new Error(response?.code || response?.message || `${action} no devolvio ok=true`);
  }

  return response;
}

export async function loadFullyBookedFromManagerApi(date: string) {
  const response = await callFullyBooked('fullybooked.get', { date });
  console.log('[DEMO][FULLYBOOKED] loaded', response.fullyBooked);
  return Boolean(response.fullyBooked);
}

export async function saveFullyBookedWithManagerApi(date: string, fullyBooked: boolean) {
  const response = await callFullyBooked('fullybooked.set', { date, fullyBooked });
  console.log('[DEMO][FULLYBOOKED] saved', response.fullyBooked);
  return response;
}
