interface FeedbackInvitationParams {
  idReserva: string;
  clientId: string;
  publicToken: string;
  nombre: string;
  restaurantName: string;
}

export function buildFeedbackUrl({ idReserva, clientId, publicToken }: FeedbackInvitationParams, language: 'es' | 'en') {
  const langQuery = language === 'en' ? '&lang=en' : '&lang=es';
  return `https://costabots-feedback-public.vercel.app/feedback/${encodeURIComponent(idReserva)}?id_reserva=${encodeURIComponent(idReserva)}&client_id=${encodeURIComponent(clientId)}&public_token=${encodeURIComponent(publicToken)}${langQuery}`;
}

export function maskFeedbackUrl(url: string) {
  return url.replace(/([?&]public_token=)([^&]*)/, (_match, prefix) => `${prefix}***`);
}

export function buildFeedbackInvitationES(params: FeedbackInvitationParams) {
  const { nombre, restaurantName } = params;

  return `🌴 ${restaurantName}

Hola ${nombre} 😊

Ha sido un placer atenderte.

Nos encantaría saber cómo fue tu experiencia en ${restaurantName}.

⭐ Valorar visita:
${buildFeedbackUrl(params, 'es')}

Tus comentarios nos ayudan a ofrecer un mejor servicio cada día.

¡Muchas gracias!

Equipo ${restaurantName}`;
}
