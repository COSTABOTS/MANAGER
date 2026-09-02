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
  return `https://cancel.costabots.com/?id_reserva=${encodeURIComponent(idReserva)}&client_id=${encodeURIComponent(clientId)}&public_token=${encodeURIComponent(publicToken)}`;
}

export function buildReservationReminderES(params: ReservationReminderParams) {
  const { nombre, hora, personas, restaurantName } = params;

  return `🌴 ${restaurantName}

Hola ${nombre} 😊

Te recordamos que tienes una reserva hoy a las ${hora} para ${personas} personas.

Si necesitas cancelar tu reserva, puedes hacerlo aquí:
${cancellationUrl(params)}

¡Te esperamos!

Equipo ${restaurantName}`;
}
