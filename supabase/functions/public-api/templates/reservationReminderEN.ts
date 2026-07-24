interface ReservationReminderParams {
  idReserva: string;
  nombre: string;
  hora: string;
  personas: number;
  restaurantName: string;
}

export function buildReservationReminderEN({
  idReserva,
  nombre,
  hora,
  personas,
  restaurantName,
}: ReservationReminderParams) {
  return `🌴 ${restaurantName}

Hello ${nombre} 😊

This is a reminder that you have a reservation today at ${hora} for ${personas} guests.

If you need to cancel your reservation, you can do so here:
https://costabots-cancelacion-public.vercel.app/?id_reserva=${encodeURIComponent(idReserva)}

We look forward to welcoming you!

${restaurantName} Team`;
}
