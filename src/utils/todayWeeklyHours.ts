import type { BookingService } from '../types';
import type { WeeklyHoursRow } from '../services/weeklyHoursApiContract';

export function getTodayWeeklyHoursLabel(date: string, service: BookingService | null, rules: readonly WeeklyHoursRow[]): string | null {
  if (!service || service === 'BALINESA') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Horario no disponible';
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return 'Horario no disponible';
  const weekday = parsed.getUTCDay(); // 0=domingo; noon UTC avoids local timezone shifts.
  const rule = rules.find((item) => item.weekday === weekday && item.service === service);
  if (!rule) return 'Cerrado · Sin configurar';
  if (!rule.enabled) return 'Cerrado hoy';
  if (!rule.start_time || !rule.end_time) return 'Cerrado · Sin configurar';
  return `Horario hoy: ${rule.start_time.slice(0, 5)}–${rule.end_time.slice(0, 5)} (fin exclusivo)`;
}
