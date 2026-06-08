export interface CapacitySlotPayload {
  hora: string;
  limite: number;
  activo: boolean;
}

export interface CapacityPayload {
  action: 'UPDATE_CAPACITY';
  restaurant: string;
  slots: CapacitySlotPayload[];
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mins = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

export function generateTimeSlots(openTime: string, closeTime: string, intervalMinutes: 30 | 60) {
  const opening = timeToMinutes(openTime);
  const closing = timeToMinutes(closeTime);

  if (!Number.isFinite(opening) || !Number.isFinite(closing) || closing < opening) {
    return [openTime];
  }

  const slots: string[] = [];
  for (let current = opening; current <= closing; current += intervalMinutes) {
    slots.push(minutesToTime(current));
  }
  return slots;
}

export function buildCapacityPayload(
  restaurant: string,
  slotCapacity: Record<string, number>,
  orderedSlots = Object.keys(slotCapacity),
): CapacityPayload {
  return {
    action: 'UPDATE_CAPACITY',
    restaurant,
    slots: orderedSlots.map((hora) => {
      const limite = slotCapacity[hora] ?? 0;
      return {
      hora,
      limite,
      activo: limite > 0,
      };
    }),
  };
}
