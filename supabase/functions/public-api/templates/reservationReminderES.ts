interface ReservationReminderParams {
  idReserva: string;
  nombre: string;
  hora: string;
  personas: number;
  restaurantName: string;
}

export function buildReservationReminderES({
  idReserva,
  nombre,
  hora,
  personas,
  restaurantName,
}: ReservationReminderParams) {
  return `🌴 ${restaurantName}

Hola ${nombre} 😊

Te recordamos que tienes una reserva hoy a las ${hora} para ${personas} personas.

Si necesitas cancelar tu reserva, puedes hacerlo aquí:
https://costabots-cancelacion-public.vercel.app/?id_reserva=${encodeURIComponent(idReserva)}

¡Te esperamos!

Equipo ${restaurantName}`;
}
