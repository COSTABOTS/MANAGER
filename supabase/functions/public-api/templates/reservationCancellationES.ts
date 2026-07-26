import type { PublicCancellationReservation } from '../lib/cancellations.ts';

interface CancellationTemplateOptions {
  restaurantName: string;
  bookingUrl?: string;
}

function bookingBlock(bookingUrl?: string) {
  return bookingUrl
    ? `
Si deseas hacer una nueva reserva, puedes hacerlo facilmente aqui:
${bookingUrl}
`
    : '';
}

export function buildReservationCancellationES(reservation: PublicCancellationReservation, options: CancellationTemplateOptions) {
  const restaurantName = options.restaurantName || 'el restaurante';

  if (reservation.servicio === 'BALINESA') {
    const packageLine = reservation.paqueteBalinesa ? `\n\n🏖️ Paquete: ${reservation.paqueteBalinesa}` : '';

    return `✅ Reserva cancelada

Hola ${reservation.nombre}.

Su reserva de balinesa para el ${reservation.fecha} ha sido cancelada correctamente.

👥 Personas: ${reservation.personas}${packageLine}
${bookingBlock(options.bookingUrl)}
Gracias por avisarnos.

${restaurantName}`;
  }

  return `✅ Reserva cancelada

Hola ${reservation.nombre}.

Su reserva para el ${reservation.fecha} a las ${reservation.hora} ha sido cancelada correctamente.

👥 Personas: ${reservation.personas}
${bookingBlock(options.bookingUrl)}
Gracias por avisarnos.

${restaurantName}`;
}
