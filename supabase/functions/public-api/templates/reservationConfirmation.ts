import type { PublicLanguage } from '../lib/normalization.ts';

export interface ReservationMessageData {
  idReserva: string;
  nombre: string;
  fecha: string;
  hora: string;
  personas: string;
  servicio: string;
  paquete: string;
  restaurantName: string;
  clientId: string;
  publicToken: string;
}

function cancellationUrl(data: ReservationMessageData, language: PublicLanguage) {
  const langQuery = language === 'en' ? '&lang=en' : '';
  return `https://costabots-cancelacion-public.vercel.app/?id_reserva=${encodeURIComponent(data.idReserva)}&client_id=${encodeURIComponent(data.clientId)}&public_token=${encodeURIComponent(data.publicToken)}${langQuery}`;
}

function restaurantEs(data: ReservationMessageData) {
  return `🌴 ${data.restaurantName}

✅ Tu reserva ha sido confirmada.

Nombre: ${data.nombre}
📅 Fecha: ${data.fecha}
🕒 Hora: ${data.hora}
👥 Personas: ${data.personas}

❌ Si necesitas cancelar tu reserva:
${cancellationUrl(data, 'es')}

¡Te esperamos!

${data.restaurantName}`;
}

function restaurantEn(data: ReservationMessageData) {
  return `🌴 ${data.restaurantName}

✅ Your reservation has been confirmed.

Name: ${data.nombre}
📅 Date: ${data.fecha}
🕒 Time: ${data.hora}
👥 Guests: ${data.personas}

❌ If you need to cancel your reservation:
${cancellationUrl(data, 'en')}

We look forward to welcoming you!

${data.restaurantName}`;
}

function balineseEs(data: ReservationMessageData) {
  return `🌴 ${data.restaurantName}

✅ Tu cama balinesa ha sido confirmada.

Nombre: ${data.nombre}
📅 Fecha: ${data.fecha}
👥 Servicio: ${data.servicio}
👥 Paquete: ${data.paquete}

❌ Si necesitas cancelar tu reserva:
${cancellationUrl(data, 'es')}

¡Te esperamos!

${data.restaurantName}`;
}

function balineseEn(data: ReservationMessageData) {
  return `🌴 ${data.restaurantName}

✅ Your Balinese bed has been confirmed.

Name: ${data.nombre}
📅 Date: ${data.fecha}
👥 Service: ${data.servicio}
👥 Package: ${data.paquete}

❌ If you need to cancel your reservation:
${cancellationUrl(data, 'en')}

We look forward to welcoming you!

${data.restaurantName}`;
}

export function buildReservationConfirmationMessage(data: ReservationMessageData, language: PublicLanguage, isBalinese: boolean) {
  if (isBalinese) {
    return language === 'en' ? balineseEn(data) : balineseEs(data);
  }

  return language === 'en' ? restaurantEn(data) : restaurantEs(data);
}
