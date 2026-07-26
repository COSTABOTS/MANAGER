import type { PublicCancellationReservation } from '../lib/cancellations.ts';

interface CancellationTemplateOptions {
  restaurantName: string;
  bookingUrl?: string;
}

function bookingBlock(bookingUrl?: string) {
  return bookingUrl
    ? `
If you would like to make a new reservation, you can easily do so here:
${bookingUrl}
`
    : '';
}

export function buildReservationCancellationEN(reservation: PublicCancellationReservation, options: CancellationTemplateOptions) {
  const restaurantName = options.restaurantName || 'the restaurant';

  if (reservation.servicio === 'BALINESA') {
    const packageLine = reservation.paqueteBalinesa ? `\n\n🏖️ Package: ${reservation.paqueteBalinesa}` : '';

    return `✅ Reservation Cancellation Confirmation

Hello ${reservation.nombre}.

We confirm that your balinese bed reservation for ${reservation.fecha} has been successfully cancelled.

👥 Guests: ${reservation.personas}${packageLine}
${bookingBlock(options.bookingUrl)}
Thank you for informing us in advance.

We look forward to welcoming you again soon.

${restaurantName}`;
  }

  return `✅ Reservation Cancellation Confirmation

Hello ${reservation.nombre}.

We confirm that your reservation for ${reservation.fecha} at ${reservation.hora} has been successfully cancelled.

👥 Guests: ${reservation.personas}
${bookingBlock(options.bookingUrl)}
Thank you for informing us in advance.

We look forward to welcoming you again soon.

${restaurantName}`;
}
