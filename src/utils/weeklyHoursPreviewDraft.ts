import type { ServiceWithHours } from '../types';
import { RESTAURANT_SERVICES, WEEKLY_DAYS, isValidWeeklyRule, type WeeklyHoursDraft } from './weeklyHoursDraft';

export type PreviewServices = Record<ServiceWithHours, boolean>;
export type WeeklySummaryGroup = { days: string[]; turns: string[] };

export function initialPreviewServices(enabled: readonly string[]): PreviewServices {
  return Object.fromEntries(RESTAURANT_SERVICES.map((service) => [service, enabled.includes(service)])) as PreviewServices;
}

export function parsePreviewServices(value: unknown): PreviewServices | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (!RESTAURANT_SERVICES.every((service) => typeof source[service] === 'boolean')) return null;
  return Object.fromEntries(RESTAURANT_SERVICES.map((service) => [service, source[service]])) as PreviewServices;
}

export function summarizeWeeklyDraft(draft: WeeklyHoursDraft, enabled: PreviewServices): WeeklySummaryGroup[] | null {
  const groups = new Map<string, WeeklySummaryGroup>();
  for (const { weekday, label } of WEEKLY_DAYS) {
    const ranges: Array<{ start: string; end: string }> = [];
    for (const service of RESTAURANT_SERVICES) {
      if (!enabled[service]) continue;
      const rule = draft[service][weekday];
      if (!isValidWeeklyRule(rule)) return null;
      if (rule.enabled) ranges.push({ start: rule.start, end: rule.end });
    }
    ranges.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const turns: Array<{ start: string; end: string }> = [];
    for (const range of ranges) {
      const last = turns[turns.length - 1];
      if (last && range.start <= last.end) {
        if (range.end > last.end) last.end = range.end;
      } else {
        turns.push({ ...range });
      }
    }
    const labels = turns.map(({ start, end }) => `${start}–${end}`);
    const key = labels.join('|');
    const group = groups.get(key);
    if (group) group.days.push(label);
    else groups.set(key, { days: [label], turns: labels });
  }
  return [...groups.values()];
}
