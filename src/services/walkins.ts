import type { Reservation, WalkInPayload } from '../types';

export interface WalkIn extends WalkInPayload {
  arrived: true;
  origin: 'WALK-IN';
}

export async function addWalkIn(payload: WalkInPayload): Promise<Reservation> {
  return {
    id: `walkin-${Date.now()}`,
    name: payload.nameOrRoom,
    room: /^\d+$/.test(payload.nameOrRoom) ? payload.nameOrRoom : '',
    date: payload.date,
    time: payload.time,
    pax: payload.pax,
    specialRequest: 'Walk-in',
    status: 'CONFIRMADA',
    source: 'WALKIN',
    table: '',
    arrived: true,
  };
}
