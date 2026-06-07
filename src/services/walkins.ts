import type { Reservation, WalkInPayload } from '../types';
import { createReservationId } from '../utils/reservationId';

export interface WalkIn extends WalkInPayload {
  arrived: true;
  origin: 'WALK-IN';
}

export async function addWalkIn(payload: WalkInPayload): Promise<Reservation> {
  const idReserva = createReservationId();

  return {
    id: idReserva,
    idReserva,
    name: payload.nameOrRoom,
    room: /^\d+$/.test(payload.nameOrRoom) ? payload.nameOrRoom : '',
    date: payload.date,
    time: payload.time,
    pax: payload.pax,
    specialRequest: '',
    status: 'CONFIRMADA',
    source: 'WALKIN',
    table: '',
    arrived: true,
  };
}
