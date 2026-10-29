import { getActiveManagerClientId, invokeManagerApi } from './managerApiClient';
import { createWeeklyHoursDraft, isCompleteWeeklyDraft, parseWeeklyHoursDraft, type WeeklyHoursDraft } from '../utils/weeklyHoursDraft';
import { createWeeklyHoursApi, type WeeklyHoursRow } from './weeklyHoursApiContract';

const weeklyHoursApi = createWeeklyHoursApi((body) => invokeManagerApi(body), getActiveManagerClientId);
export const getWeeklyHours = weeklyHoursApi.get;
export const saveWeeklyHours = weeklyHoursApi.save;

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
