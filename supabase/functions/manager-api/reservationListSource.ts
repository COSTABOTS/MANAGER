import type { ReservationRecord, ReservationStoreName } from '../_shared/reservation-store/types.ts';

export interface ReservationListSourceOptions {
  reservationStore: ReservationStoreName | string;
  reservationShadowRead: boolean;
  readSheets: () => Promise<ReservationRecord[]>;
  readSupabase: () => Promise<ReservationRecord[]>;
  runShadow: (sheetsReservations: ReservationRecord[]) => Promise<void>;
}

export async function readOfficialReservationList(options: ReservationListSourceOptions) {
  const store = String(options.reservationStore).trim().toLowerCase() || 'sheets';
  if (store === 'supabase') {
    return await options.readSupabase();
  }

  const sheetsReservations = await options.readSheets();
  if (options.reservationShadowRead) {
    await options.runShadow(sheetsReservations);
  }
  return sheetsReservations;
}
