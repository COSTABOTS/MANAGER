export type BookingStatus = 'CONFIRMADA' | 'CANCELADA';
export type BookingSource = 'LANDbot' | 'BOT' | 'WALKIN' | 'WEB' | 'HOTEL' | 'MANUAL';
export type BookingService = 'DESAYUNO' | 'ALMUERZO' | 'CENA' | 'BALINESA';
export type ServiceWithHours = Exclude<BookingService, 'BALINESA'>;
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
  language?: string;
  table: string;
  arrived: boolean;
  service?: BookingService;
  balinesePackage?: string;
  resource?: string;
  rowNumber?: number;
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

export type RestaurantTableType = 'general' | 'interior' | 'terraza' | 'vip' | 'barra' | 'privado' | 'otro';

export interface RestaurantTable {
  id: string;
  name: string;
  type: RestaurantTableType;
  active: boolean;
  capacity?: number;
  order?: number;
  mesaId?: string;
  mesa?: string;
  zona?: RestaurantTableType;
  activa?: boolean;
}

export interface ReservableResource {
  id: string;
  recursoId?: string;
  name: string;
  recurso?: string;
  zone: string;
  zona?: string;
  capacity: number;
  active: boolean;
  activa?: boolean;
  order?: number;
}

export type ClientLicenseStatus = 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'EXPIRED';
export type ClientLicensePlan = 'DEMO' | 'PRO';

export interface ClientLicense {
  status: ClientLicenseStatus;
  plan: ClientLicensePlan;
  expiresAt: string;
}

export interface ManagerSettings {
  totalCapacity: number;
  slotCapacity: Record<string, number>;
  openingTime: string;
  closingTime: string;
  bookingInterval: 30 | 60;
  openingDays: Record<Weekday, boolean>;
  reservasActivas: boolean;
  whatsappConfirmation: boolean;
  whatsappPreCena: boolean;
  whatsappPreCenaMinutes: number;
  mensajePostCena: boolean;
  mensajePostCenaHora: string;
  feedbackAlertPhone: string;
  servicesEnabled: BookingService[];
  serviceHours: Record<ServiceWithHours, { start: string; end: string }>;
  reservableResources: ReservableResource[];
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
  webhookLeerReservas: string;
  webhookCancelReservationUrl: string;
  webhookGetMesas: string;
  webhookSaveMesa: string;
  webhookGetCapacidad: string;
  webhookSettingsCapacityUrl: string;
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
