import { invokeManagerApi } from './managerApiClient';
import { createWeeklyHoursDraft, isCompleteWeeklyDraft, parseWeeklyHoursDraft, type WeeklyHoursDraft } from '../utils/weeklyHoursDraft';

export type WeeklyHoursRow = {
  weekday: number;
  service: 'DESAYUNO' | 'ALMUERZO' | 'CENA';
  enabled: boolean;
  start_time: string | null;
  end_time: string | null;
};

type WeeklyHoursResponse = { ok: boolean; rules: WeeklyHoursRow[]; revision: string; code?: string };

function requireResponse(response: WeeklyHoursResponse): WeeklyHoursResponse {
  if (!response?.ok || !Array.isArray(response.rules) || typeof response.revision !== 'string') {
    throw new Error(response?.code || 'WEEKLY_HOURS_READ_FAILED');
  }
  return response;
}

export async function getWeeklyHours() {
  return requireResponse(await invokeManagerApi<WeeklyHoursResponse>({ action: 'weeklyHours.get' }));
}

export async function saveWeeklyHours(rules: WeeklyHoursRow[], expectedRevision: string) {
  return requireResponse(await invokeManagerApi<WeeklyHoursResponse>({ action: 'weeklyHours.save', rules, expected_revision: expectedRevision }));
}

export function draftFromWeeklyRows(rows: WeeklyHoursRow[]): WeeklyHoursDraft | null {
  if (rows.length === 0) return createWeeklyHoursDraft();
  if (rows.length !== 21) return null;
  const draft = createWeeklyHoursDraft();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 || !(row.service in draft)) return null;
    const key = `${row.weekday}:${row.service}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const start = row.start_time?.slice(0, 5) ?? '';
    const end = row.end_time?.slice(0, 5) ?? '';
    draft[row.service][row.weekday] = { enabled: row.enabled, start, end };
  }
  if (seen.size !== 21) return null;
  const parsed = parseWeeklyHoursDraft(draft);
  return parsed && isCompleteWeeklyDraft(parsed) ? parsed : null;
}
