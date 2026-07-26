import { normalizePhone, toStringValue, type PublicLanguage } from './normalization.ts';

export interface PublicClientMessageData {
  restaurantName: string;
  bookingUrl: string;
  contactPhone: string;
}

function isPublicUrl(value: string) {
  return /^https:\/\/[^\s]+$/i.test(value) || /^http:\/\/localhost(?::\d+)?(?:\/[^\s]*)?$/i.test(value);
}

export function getClientRestaurantName(client: Record<string, unknown>, language: PublicLanguage = 'es') {
  return toStringValue(client.rest_name ?? client.restName) || (language === 'en' ? 'the restaurant' : 'el restaurante');
}

export function getClientBookingUrl(client: Record<string, unknown>) {
  const rawUrl = toStringValue(client.booking_url ?? client.bookingUrl ?? client.public_url ?? client.publicUrl ?? client.bot_url ?? client.botUrl);
  return rawUrl && isPublicUrl(rawUrl) ? rawUrl : '';
}

export function getClientContactPhone(client: Record<string, unknown>) {
  return normalizePhone(client.contact_phone ?? client.contactPhone);
}

export function getPublicClientMessageData(client: Record<string, unknown>, language: PublicLanguage = 'es'): PublicClientMessageData {
  return {
    restaurantName: getClientRestaurantName(client, language),
    bookingUrl: getClientBookingUrl(client),
    contactPhone: getClientContactPhone(client),
  };
}
