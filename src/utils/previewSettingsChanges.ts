import type { ManagerSettings } from '../types';
import { generateTimeSlots } from './capacity';

export function changedSettingValues(current: Record<string, string>, next: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => current[key] !== value));
}

export function changedSettingsConflict(current: Record<string, string>, remote: Record<string, string>, changed: Record<string, string>): boolean {
  return Object.keys(changed).some((key) => remote[key] !== current[key]);
}

export function capacitySettingsChanged(current: ManagerSettings, next: ManagerSettings, weekly = false): boolean {
  if (weekly) return JSON.stringify(current.serviceSlotCapacity) !== JSON.stringify(next.serviceSlotCapacity);
  return (['totalCapacity', 'slotCapacity', 'serviceSlotCapacity', 'openingTime', 'closingTime', 'bookingInterval', 'serviceHours'] as const)
    .some((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]));
}

export function serviceCapacitySlotsForSave(
  configured: Record<string, number>,
  legacyHours: { start: string; end: string },
  interval: 30 | 60,
  weekly: boolean,
  previous?: Record<string, number>,
): Array<{ hora: string; limite: number; activo: boolean }> {
  const hours = weekly
    ? Object.keys(configured).filter((hora) => previous === undefined || configured[hora] !== previous[hora])
    : generateTimeSlots(legacyHours.start, legacyHours.end, interval);
  return hours.map((hora) => {
    const limite = configured[hora] ?? 20;
    return { hora, limite, activo: limite > 0 };
  });
}

export function capacityReadbackMatches(
  changes: readonly { service: 'DESAYUNO' | 'ALMUERZO' | 'CENA'; hora: string; limite: number }[],
  services: Partial<Record<'DESAYUNO' | 'ALMUERZO' | 'CENA',
    Array<{ hora: string; limite: number; activo: boolean }>>> | undefined,
): boolean {
  return Boolean(services) && changes.every(({ service, hora, limite }) => {
    const row = services?.[service]?.find((item) => item.hora === hora);
    return Boolean(row && (row.activo ? row.limite : 0) === limite);
  });
}
