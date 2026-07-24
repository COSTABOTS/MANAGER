import type { PublicCancellationReservation } from '../lib/cancellations.ts';

export function buildReservationCancellationEN(reservation: PublicCancellationReservation) {
  return `✅ Reservation Cancellation Confirmation

Hello ${reservation.nombre}.

We confirm that your reservation for ${reservation.fecha} at ${reservation.hora} has been successfully cancelled.

👥 Guests: ${reservation.personas}

Thank you for informing us in advance.

We look forward to welcoming you again soon.

Safari Restaurant`;
}
