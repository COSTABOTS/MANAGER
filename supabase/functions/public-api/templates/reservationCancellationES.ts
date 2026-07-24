import type { PublicCancellationReservation } from '../lib/cancellations.ts';

export function buildReservationCancellationES(reservation: PublicCancellationReservation) {
  return `✅ Reserva cancelada

Hola ${reservation.nombre}.

Su reserva para el ${reservation.fecha} a las ${reservation.hora} ha sido cancelada correctamente.

👥 Personas: ${reservation.personas}

Gracias por avisarnos.

Safari Restaurant`;
}
