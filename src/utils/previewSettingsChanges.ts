import type { ManagerSettings } from '../types';

export function changedSettingValues(current: Record<string, string>, next: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => current[key] !== value));
}

export function changedSettingsConflict(current: Record<string, string>, remote: Record<string, string>, changed: Record<string, string>): boolean {
  return Object.keys(changed).some((key) => remote[key] !== current[key]);
}

export function capacitySettingsChanged(current: ManagerSettings, next: ManagerSettings): boolean {
  return (['totalCapacity', 'slotCapacity', 'serviceSlotCapacity', 'openingTime', 'closingTime', 'bookingInterval', 'serviceHours'] as const)
    .some((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]));
}
