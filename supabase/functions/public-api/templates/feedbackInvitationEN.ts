import { buildFeedbackUrl } from './feedbackInvitationES.ts';

interface FeedbackInvitationParams {
  idReserva: string;
  clientId: string;
  publicToken: string;
  nombre: string;
  restaurantName: string;
}

export function buildFeedbackInvitationEN(params: FeedbackInvitationParams) {
  const { nombre, restaurantName } = params;

  return `🌴 ${restaurantName}

Hello ${nombre} 😊

Thank you for visiting ${restaurantName}.

We hope you enjoyed your experience with us.

⭐ We'd love to hear your feedback:
${buildFeedbackUrl(params, 'en')}

Your opinion helps us continue improving and providing the best possible service.

Thank you for your time, and we look forward to welcoming you again soon.

${restaurantName} Team`;
}
