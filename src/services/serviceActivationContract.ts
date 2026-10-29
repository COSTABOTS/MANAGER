import type { BookingService } from '../types';

const SERVICES: BookingService[] = ['DESAYUNO', 'ALMUERZO', 'CENA', 'BALINESA'];
type ApiResponse = { ok?: boolean; client_id?: string; settings?: Record<string, unknown> };
type Invoke = (body: Record<string, unknown>) => Promise<ApiResponse>;

export function parseEnabledServices(settings: unknown): BookingService[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('SERVICES_READ_INVALID');
  const raw = (settings as Record<string, unknown>).SERVICES_ENABLED;
  if (raw === undefined || raw === null) return ['CENA']; // Legacy setting absent.
  if (typeof raw !== 'string') throw new Error('SERVICES_READ_INVALID');
  if (!raw.trim()) return [];
  const entries = raw.split(/[;,\n]/).map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (entries.some((entry) => !SERVICES.includes(entry as BookingService))) throw new Error('SERVICES_READ_INVALID');
  return [...new Set(entries)] as BookingService[];
}

function sameServices(left: readonly BookingService[], right: readonly BookingService[]) {
  return left.length === right.length && left.every((service) => right.includes(service));
}

export function changeEnabledService(current: readonly BookingService[], service: BookingService, enabled: boolean): BookingService[] {
  if (!SERVICES.includes(service)) throw new Error('SERVICE_INVALID');
  const next = enabled ? [...new Set([...current, service])] : current.filter((item) => item !== service);
  // An empty value is interpreted as CENA by the current public widget/config contract.
  if (next.length === 0) throw new Error('LAST_SERVICE_UNSAFE');
  return next;
}

export function createServiceActivationClient(invoke: Invoke, activeClientId: () => string) {
  return async (clientId: string, expected: readonly BookingService[], service: BookingService, enabled: boolean): Promise<BookingService[]> => {
    if (!clientId || activeClientId() !== clientId) throw new Error('TENANT_CHANGED');
    const loaded = await invoke({ action: 'settings.get' });
    if (!loaded.ok || loaded.client_id !== clientId) throw new Error('SERVICES_READ_INVALID');
    const current = parseEnabledServices(loaded.settings);
    if (!sameServices(current, expected)) throw new Error('SERVICES_CONFLICT');
    const next = changeEnabledService(current, service, enabled);
    if (sameServices(current, next)) return current;
    if (activeClientId() !== clientId) throw new Error('TENANT_CHANGED');
    const saved = await invoke({ action: 'settings.save', settings: { SERVICES_ENABLED: next.join(',') } });
    if (!saved.ok || saved.client_id !== clientId) throw new Error('SERVICE_SAVE_UNCONFIRMED');
    if (activeClientId() !== clientId) throw new Error('TENANT_CHANGED');
    const verified = await invoke({ action: 'settings.get' });
    if (!verified.ok || verified.client_id !== clientId || !sameServices(parseEnabledServices(verified.settings), next)) {
      throw new Error('SERVICE_SAVE_UNCONFIRMED');
    }
    return next;
  };
}
