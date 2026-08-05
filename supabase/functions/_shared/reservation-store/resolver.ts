import { ReservationStoreNotEnabledError } from './errors.ts';
import { SheetsReservationStore } from './sheetsReservationStore.ts';
import { SupabaseReservationStore, type SupabaseReadClient } from './supabaseReservationStore.ts';
import type {
  ReservationStore,
  ReservationStoreClientContext,
  SheetsReservationStoreOperations,
} from './types.ts';

function normalizeStoreName(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function resolveReservationStore(
  context: ReservationStoreClientContext,
  sheetsOperations: SheetsReservationStoreOperations,
  supabaseClient?: SupabaseReadClient,
): ReservationStore {
  const configuredStore = normalizeStoreName(context.reservationStore) || 'sheets';
  if (configuredStore === 'supabase') {
    if (!supabaseClient) throw new ReservationStoreNotEnabledError('supabase_client_missing');
    return new SupabaseReservationStore(context, supabaseClient);
  }
  if (configuredStore !== 'sheets') {
    throw new ReservationStoreNotEnabledError(configuredStore);
  }

  return new SheetsReservationStore(context, sheetsOperations);
}
