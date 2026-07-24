import type { PublicCancellationReservation } from '../lib/cancellations.ts';

const RESERVATION_LINK = 'https://safari.costabots.com';

export function buildReservationCancellationEN(reservation: PublicCancellationReservation) {
  if (reservation.servicio === 'BALINESA') {
    const packageLine = reservation.paqueteBalinesa ? `\n\n🏖️ Package: ${reservation.paqueteBalinesa}` : '';

    return `✅ Reservation Cancellation Confirmation

Hello ${reservation.nombre}.

We confirm that your balinese bed reservation for ${reservation.fecha} has been successfully cancelled.

👥 Guests: ${reservation.personas}${packageLine}

If you would like to make a new reservation, you can easily do so here:
${RESERVATION_LINK}

Thank you for informing us in advance.

We look forward to welcoming you again soon.

Safari Restaurant`;
  }

  return `✅ Reservation Cancellation Confirmation

Hello ${reservation.nombre}.

We confirm that your reservation for ${reservation.fecha} at ${reservation.hora} has been successfully cancelled.

👥 Guests: ${reservation.personas}

If you would like to make a new reservation, you can easily do so here:
${RESERVATION_LINK}

Thank you for informing us in advance.

We look forward to welcoming you again soon.

Safari Restaurant`;
}
