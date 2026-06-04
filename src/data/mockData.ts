import { mockReservations, todayState } from './mockReservations';
import type { ManagerSettings, Show } from '../types';

export const mockSlotCapacity = {
  '18:00': 40,
  '18:30': 40,
  '19:00': 40,
  '19:30': 40,
  '20:00': 40,
  '20:30': 40,
  '21:00': 40,
  '21:30': 40,
  '22:00': 40,
  '22:30': 40,
  '23:00': 40,
};

export const mockSettings: ManagerSettings = {
  totalCapacity: 60,
  openingTime: '18:00',
  closingTime: '23:00',
  bookingInterval: 30,
  openingDays: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
  },
  reservasActivas: true,
  whatsappPreCena: false,
  filtroResenas: true,
  mensajePostCena: false,
  restaurantName: 'Safari',
  logoUrl: '',
  primaryColor: '#4f83dc',
  googleSheetId: '',
  reservationsWebhook: '',
  walkInWebhook: '',
  feedbacksWebhook: '',
  showsWebhook: '',
  licenseActive: true,
  slotCapacity: mockSlotCapacity,
};

export const mockShows: Show[] = [
  {
    id: 's1',
    name: 'Safari Live Band',
    type: 'recurring',
    weekday: 'friday',
    time: '20:30',
    active: true,
    visibleInChatbot: true,
    bookable: true,
  },
  {
    id: 's2',
    name: 'Flamenco Night',
    type: 'recurring',
    weekday: 'tuesday',
    time: '21:00',
    active: true,
    visibleInChatbot: true,
    bookable: true,
  },
  {
    id: 's3',
    name: 'DJ Sunset',
    type: 'single',
    date: '2026-08-15',
    time: '22:00',
    active: false,
    visibleInChatbot: false,
    bookable: false,
  },
];

export { mockReservations, todayState };
