import { ReservationStoreOperationNotConfiguredError } from './errors.ts';
import type {
  AvailabilityQuery,
  AvailabilityResult,
  CreateReservationCommand,
  CreateReservationResult,
  ReservationRecord,
  ReservationStore,
  ReservationStoreClientContext,
  SheetsReservationStoreOperations,
} from './types.ts';

export class SheetsReservationStore implements ReservationStore {
  readonly name = 'sheets' as const;
  readonly context: ReservationStoreClientContext;
  private readonly operations: SheetsReservationStoreOperations;

  constructor(
    context: ReservationStoreClientContext,
    operations: SheetsReservationStoreOperations,
  ) {
    this.context = context;
    this.operations = operations;
  }

  getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    return this.requireOperation('getAvailability')(query);
  }

  listReservations(): Promise<ReservationRecord[]> {
    return this.requireOperation('listReservations')();
  }

  getReservation(id: string): Promise<ReservationRecord | null> {
    return this.requireOperation('getReservation')(id);
  }

  createReservation(command: CreateReservationCommand): Promise<CreateReservationResult> {
    return this.requireOperation('createReservation')(command);
  }

  createManualReservation(command: CreateReservationCommand): Promise<CreateReservationResult> {
    return this.requireOperation('createManualReservation')(command);
  }

  createWalkIn(command: CreateReservationCommand): Promise<CreateReservationResult> {
    return this.requireOperation('createWalkIn')(command);
  }

  private requireOperation<K extends keyof SheetsReservationStoreOperations>(operation: K) {
    const handler = this.operations[operation];
    if (!handler) {
      throw new ReservationStoreOperationNotConfiguredError(operation);
    }
    return handler as NonNullable<SheetsReservationStoreOperations[K]>;
  }
}
