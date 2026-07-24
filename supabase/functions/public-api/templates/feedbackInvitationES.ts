interface FeedbackInvitationParams {
  idReserva: string;
  nombre: string;
  restaurantName: string;
}

export function buildFeedbackInvitationES({ idReserva, nombre, restaurantName }: FeedbackInvitationParams) {
  return `🌴 ${restaurantName}

Hola ${nombre} 😊

Ha sido un placer atenderte.

Nos encantaría saber cómo fue tu experiencia en ${restaurantName}.

⭐ Valorar visita:
https://costabots-feedback-public.vercel.app/feedback/${encodeURIComponent(idReserva)}?lang=es

Tus comentarios nos ayudan a ofrecer un mejor servicio cada día.

¡Muchas gracias!

Equipo ${restaurantName}`;
}
