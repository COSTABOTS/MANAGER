export type BookingStatus = 'CONFIRMADA' | 'CANCELADA';
export type BookingSource = 'LANDbot' | 'BOT' | 'WALKIN' | 'WEB' | 'HOTEL' | 'MANUAL';
export type DateBookingStatusValue = 'open' | 'fully_booked';
export type DateBookingStatus = Record<string, DateBookingStatusValue>;

export interface Reservation {
  id: string;
  idReserva: string;
  name: string;
  room: string;
  date: string;
  time: string;
  pax: number;
  specialRequest: string;
  phone?: string;
  status: BookingStatus;
  source: BookingSource;
  table: string;
  arrived: boolean;
}

export interface DayState {
  date: string;
  bookingsOpen: boolean;
  fullyBooked: boolean;
}

export interface WalkInPayload {
  nameOrRoom: string;
  pax: number;
  date: string;
  time: string;
  status: 'CONFIRMADA';
  source: 'WALKIN';
}

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface Show {
  id: string;
  name: string;
  type: 'single' | 'recurring';
  date?: string;
  weekday?: Weekday;
  time: string;
  active: boolean;
  visibleInChatbot: boolean;
  bookable: boolean;
}

export type RestaurantTableType = 'interior' | 'terraza' | 'vip' | 'barra' | 'privado' | 'otro';

export interface RestaurantTable {
  id: string;
  name: string;
  type: RestaurantTableType;
  active: boolean;
}

export interface ManagerSettings {
  totalCapacity: number;
  slotCapacity: Record<string, number>;
  openingTime: string;
  closingTime: string;
  bookingInterval: 30 | 60;
  openingDays: Record<Weekday, boolean>;
  reservasActivas: boolean;
  whatsappPreCena: boolean;
  filtroResenas: boolean;
  mensajePostCena: boolean;
  costabotsLogoUrl: string;
  restaurantName: string;
  restaurantLogoUrl: string;
  primaryColor: string;
  googleSheetId: string;
  webhookReservas: string;
  webhookWalkin: string;
  webhookLlegada: string;
  webhookMesa: string;
  webhookFullyBooked: string;
  webhookShows: string;
  webhookFeedbacks: string;
  webhookSettings: string;
  reservationsWebhook: string;
  walkInWebhook: string;
  feedbacksWebhook: string;
  showsWebhook: string;
  licenseActive: boolean;
  tables: RestaurantTable[];
}
