import type { PublicLanguage } from '../lib/normalization.ts';

export interface ReservationMessageData {
  idReserva: string;
  nombre: string;
  fecha: string;
  hora: string;
  personas: string;
  servicio: string;
  paquete: string;
}

function restaurantEs(data: ReservationMessageData) {
  return `🌴 Safari Restaurant

✅ Tu reserva ha sido confirmada.

Nombre: ${data.nombre}
📅 Fecha: ${data.fecha}
🕒 Hora: ${data.hora}
👥 Personas: ${data.personas}

❌ Si necesitas cancelar tu reserva:
https://costabots-cancelacion-public.vercel.app/?id_reserva=${encodeURIComponent(data.idReserva)}

¡Te esperamos!

Safari Restaurant`;
}

function restaurantEn(data: ReservationMessageData) {
  return `🌴 Safari Restaurant

✅ Your reservation has been confirmed.

Name: ${data.nombre}
📅 Date: ${data.fecha}
🕒 Time: ${data.hora}
👥 Guests: ${data.personas}

❌ If you need to cancel your reservation:
https://costabots-cancelacion-public.vercel.app/?id_reserva=${encodeURIComponent(data.idReserva)}&lang=en

We look forward to welcoming you!

Safari Restaurant`;
}

function balineseEs(data: ReservationMessageData) {
  return `🌴 Santa Cruz Suites

✅ Tu cama balinesa ha sido confirmada.

Nombre: ${data.nombre}
📅 Fecha: ${data.fecha}
👥 Servicio: ${data.servicio}
👥 Paquete: ${data.paquete}

❌ Si necesitas cancelar tu reserva:
https://costabots-cancelacion-public.vercel.app/?id_reserva=${encodeURIComponent(data.idReserva)}

¡Te esperamos!

Santa Cruz Suites`;
}

function balineseEn(data: ReservationMessageData) {
  return `🌴 Santa Cruz Suites

✅ Your Balinese bed has been confirmed.

Name: ${data.nombre}
📅 Date: ${data.fecha}
👥 Service: ${data.servicio}
👥 Package: ${data.paquete}

❌ If you need to cancel your reservation:
https://costabots-cancelacion-public.vercel.app/?id_reserva=${encodeURIComponent(data.idReserva)}

We look forward to welcoming you!

Santa Cruz Suites`;
}

export function buildReservationConfirmationMessage(data: ReservationMessageData, language: PublicLanguage, isBalinese: boolean) {
  if (isBalinese) {
    return language === 'en' ? balineseEn(data) : balineseEs(data);
  }

  return language === 'en' ? restaurantEn(data) : restaurantEs(data);
}
