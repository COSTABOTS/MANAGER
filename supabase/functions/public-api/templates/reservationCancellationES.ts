import type { PublicCancellationReservation } from '../lib/cancellations.ts';

const RESERVATION_LINK = 'https://safari.costabots.com';

export function buildReservationCancellationES(reservation: PublicCancellationReservation) {
  if (reservation.servicio === 'BALINESA') {
    const packageLine = reservation.paqueteBalinesa ? `\n\n🏖️ Paquete: ${reservation.paqueteBalinesa}` : '';

    return `✅ Reserva cancelada

Hola ${reservation.nombre}.

Su reserva de balinesa para el ${reservation.fecha} ha sido cancelada correctamente.

👥 Personas: ${reservation.personas}${packageLine}

Si deseas hacer una nueva reserva, puedes hacerlo fácilmente aquí:
${RESERVATION_LINK}

Gracias por avisarnos.

Safari Restaurant`;
  }

  return `✅ Reserva cancelada

Hola ${reservation.nombre}.

Su reserva para el ${reservation.fecha} a las ${reservation.hora} ha sido cancelada correctamente.

👥 Personas: ${reservation.personas}

Si deseas hacer una nueva reserva, puedes hacerlo fácilmente aquí:
${RESERVATION_LINK}

Gracias por avisarnos.

Safari Restaurant`;
}
