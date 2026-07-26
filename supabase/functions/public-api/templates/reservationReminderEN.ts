interface ReservationReminderParams {
  idReserva: string;
  clientId: string;
  publicToken: string;
  nombre: string;
  hora: string;
  personas: number;
  restaurantName: string;
}

function cancellationUrl({ idReserva, clientId, publicToken }: ReservationReminderParams) {
  return `https://costabots-cancelacion-public.vercel.app/?id_reserva=${encodeURIComponent(idReserva)}&client_id=${encodeURIComponent(clientId)}&public_token=${encodeURIComponent(publicToken)}&lang=en`;
}

export function buildReservationReminderEN(params: ReservationReminderParams) {
  const { nombre, hora, personas, restaurantName } = params;

  return `🌴 ${restaurantName}

Hello ${nombre} 😊

This is a reminder that you have a reservation today at ${hora} for ${personas} guests.

If you need to cancel your reservation, you can do so here:
${cancellationUrl(params)}

We look forward to welcoming you!

${restaurantName} Team`;
}
