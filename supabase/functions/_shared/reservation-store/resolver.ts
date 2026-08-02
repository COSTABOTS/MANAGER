import { ReservationStoreNotEnabledError } from './errors.ts';
import { SheetsReservationStore } from './sheetsReservationStore.ts';
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
): ReservationStore {
  const configuredStore = normalizeStoreName(context.reservationStore) || 'sheets';
  if (configuredStore !== 'sheets') {
    throw new ReservationStoreNotEnabledError(configuredStore);
  }

  return new SheetsReservationStore(context, sheetsOperations);
}
