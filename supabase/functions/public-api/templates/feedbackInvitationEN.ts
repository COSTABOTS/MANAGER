interface FeedbackInvitationParams {
  idReserva: string;
  nombre: string;
  restaurantName: string;
}

export function buildFeedbackInvitationEN({ idReserva, nombre, restaurantName }: FeedbackInvitationParams) {
  return `🌴 ${restaurantName}

Hello ${nombre} 😊

Thank you for visiting ${restaurantName}.

We hope you enjoyed your experience with us.

⭐ We'd love to hear your feedback:
https://costabots-feedback-public.vercel.app/feedback/${encodeURIComponent(idReserva)}?lang=en

Your opinion helps us continue improving and providing the best possible service.

Thank you for your time, and we look forward to welcoming you again soon.

${restaurantName} Team`;
}
