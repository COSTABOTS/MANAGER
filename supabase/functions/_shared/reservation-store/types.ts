export type ReservationStoreName = 'sheets' | 'supabase';

export interface ReservationStoreClientContext {
  clientId: string;
  sheetId: string;
  reservationStore?: unknown;
  reservationShadowRead?: unknown;
}

export interface AvailabilityQuery {
  date: string;
  requestedPax: number;
  requestedTime?: string;
}

export interface AvailabilityResult {
  requestedPax: number;
  availableTimes: string[];
  requestedTimeAvailable: boolean;
}

export interface ReservationRecord {
  id: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  pax: number;
  language: string;
  specialRequest: string;
  status: string;
  origin: string;
  table: string;
  arrived: boolean;
  feedbackSent: boolean;
  room: string;
  service: string;
  balinesePackage: string;
  resource: string;
  sourceChannel?: string;
}

export interface CreateReservationCommand {
  id: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  pax: number;
  language: string;
  specialRequest: string;
  status: string;
  origin: string;
  table: string;
  arrived: boolean;
  feedbackSent: boolean;
  room: string;
  service: string;
  balinesePackage: string;
  resource: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateReservationResult {
  reservation: CreateReservationCommand;
}

export interface ReservationStore {
  readonly name: ReservationStoreName;
  getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult>;
  listReservations(): Promise<ReservationRecord[]>;
  getReservation(id: string): Promise<ReservationRecord | null>;
  createReservation(command: CreateReservationCommand): Promise<CreateReservationResult>;
  createManualReservation(command: CreateReservationCommand): Promise<CreateReservationResult>;
  createWalkIn(command: CreateReservationCommand): Promise<CreateReservationResult>;
}

export interface SheetsReservationStoreOperations {
  getAvailability?: (query: AvailabilityQuery) => Promise<AvailabilityResult>;
  listReservations?: () => Promise<ReservationRecord[]>;
  getReservation?: (id: string) => Promise<ReservationRecord | null>;
  createReservation?: (command: CreateReservationCommand) => Promise<CreateReservationResult>;
  createManualReservation?: (command: CreateReservationCommand) => Promise<CreateReservationResult>;
  createWalkIn?: (command: CreateReservationCommand) => Promise<CreateReservationResult>;
}
