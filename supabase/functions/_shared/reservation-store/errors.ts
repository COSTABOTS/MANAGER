export class ReservationStoreNotEnabledError extends Error {
  constructor(store: string) {
    super(`RESERVATION_STORE_NOT_ENABLED: ${store}`);
    this.name = 'ReservationStoreNotEnabledError';
  }
}

export class ReservationStoreOperationNotConfiguredError extends Error {
  constructor(operation: string) {
    super(`RESERVATION_STORE_OPERATION_NOT_CONFIGURED: ${operation}`);
    this.name = 'ReservationStoreOperationNotConfiguredError';
  }
}
