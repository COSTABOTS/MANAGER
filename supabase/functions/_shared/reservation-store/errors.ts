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

const restaurantRpcRejectionCodes = [
  'RESERVATION_TIME_PASSED',
  'RESERVATION_OUTSIDE_WEEKLY_HOURS',
  'WEEKLY_HOURS_CONFIG_INVALID',
  'WEEKLY_HOURS_CONFIG_READ_FAILED',
  'AVAILABILITY_EXHAUSTED',
  'WALKIN_OUTSIDE_WEEKLY_HOURS',
  'SERVICE_NOT_ENABLED',
  'BOOKINGS_DISABLED',
] as const;

export type RestaurantRpcRejectionCode = typeof restaurantRpcRejectionCodes[number];

export class RestaurantRpcRejection extends Error {
  constructor(readonly publicCode: RestaurantRpcRejectionCode) {
    super(publicCode);
    this.name = 'RestaurantRpcRejection';
  }
}

export function parseRestaurantRpcRejection(error: { code?: string; message: string }): RestaurantRpcRejection | null {
  if (error.code !== 'P0001') return null;
  const code = restaurantRpcRejectionCodes.find((candidate) => candidate === error.message);
  return code ? new RestaurantRpcRejection(code) : null;
}
