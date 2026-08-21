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
  service?: string;
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
  balinesePaid?: boolean;
  resource: string;
  sourceChannel?: string;
  createdAt?: string;
  preDinnerSent?: boolean;
}

export interface CreateFeedbackCommand {
  reservationId: string;
  rating: number;
  comment: string;
  submittedAt: string;
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

export interface ReservationMutationResult { reservation: ReservationRecord }

export interface ReservationStore {
  readonly name: ReservationStoreName;
  getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult>;
  listReservations(): Promise<ReservationRecord[]>;
  getReservation(id: string): Promise<ReservationRecord | null>;
  createReservation(command: CreateReservationCommand): Promise<CreateReservationResult>;
  createBalineseReservation?(command: CreateReservationCommand): Promise<CreateReservationResult>;
  createManualReservation(command: CreateReservationCommand): Promise<CreateReservationResult>;
  createWalkIn(command: CreateReservationCommand): Promise<CreateReservationResult>;
  cancelReservation?(id: string): Promise<ReservationMutationResult>;
  updateArrival?(id: string, arrived: boolean): Promise<ReservationMutationResult>;
  assignTable?(id: string, table: string): Promise<ReservationMutationResult>;
  updateReservationPhone?(id: string, phone: string): Promise<ReservationMutationResult>;
  getFeedbackByReservation?(id: string): Promise<boolean>;
  createFeedback?(command: CreateFeedbackCommand): Promise<{ created: boolean }>;
  markPreDinnerSent?(id: string): Promise<ReservationMutationResult>;
  markFeedbackSent?(id: string): Promise<ReservationMutationResult>;
  updateBalinesePaid?(id: string, paid: boolean): Promise<ReservationMutationResult>;
  listPendingReminderReservations?(date: string): Promise<ReservationRecord[]>;
  listPendingFeedbackReservations?(date: string): Promise<ReservationRecord[]>;
}

export interface SheetsReservationStoreOperations {
  getAvailability?: (query: AvailabilityQuery) => Promise<AvailabilityResult>;
  listReservations?: () => Promise<ReservationRecord[]>;
  getReservation?: (id: string) => Promise<ReservationRecord | null>;
  createReservation?: (command: CreateReservationCommand) => Promise<CreateReservationResult>;
  createManualReservation?: (command: CreateReservationCommand) => Promise<CreateReservationResult>;
  createWalkIn?: (command: CreateReservationCommand) => Promise<CreateReservationResult>;
  cancelReservation?: (id: string) => Promise<ReservationMutationResult>;
  updateArrival?: (id: string, arrived: boolean) => Promise<ReservationMutationResult>;
  assignTable?: (id: string, table: string) => Promise<ReservationMutationResult>;
}
