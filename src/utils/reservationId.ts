export function createReservationId() {
  return `RES-${Math.floor(Date.now() / 1000)}`;
}
