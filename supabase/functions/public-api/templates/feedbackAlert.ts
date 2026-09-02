import type { NormalizedFeedbackSubmit, PublicFeedbackReservation } from '../lib/feedback.ts';

export function buildFeedbackAlertMessage(
  reservation: PublicFeedbackReservation,
  feedback: NormalizedFeedbackSubmit,
  restaurantName = '',
) {
  return `🚨 ALERTA EXPERIENCIA CLIENTE${restaurantName ? `\n${restaurantName}` : ''}

Idioma: ${feedback.idioma.toUpperCase()}
Cliente: ${reservation.nombre}
Habitación: ${reservation.habitacion || '-'}
Fecha de la reserva: ${reservation.fecha}
Hora: ${reservation.hora || '-'}
Personas: ${reservation.personas}
Servicio: ${reservation.servicio}

Valoración: ${feedback.puntuacionTexto}

Comentario:
${feedback.comentario || '-'}

Contacto del cliente:
${reservation.telefono || '-'}

Se recomienda seguimiento personalizado por parte del manager.`;
}
