export type WeeklyMode = 'legacy' | 'weekly' | 'unknown';

// The caller must first obtain a successful settings.get for the authenticated tenant.
export function resolveWeeklyModeFromSettings(settings: Record<string, unknown> | Record<string, unknown>[]): WeeklyMode {
  const raw = Array.isArray(settings)
    ? settings.find((row) => String(row.VARIABLE ?? row.CLAVE ?? row.key ?? '') === 'WEEKLY_HOURS_ENABLED')?.VALUE
      ?? settings.find((row) => String(row.VARIABLE ?? row.CLAVE ?? row.key ?? '') === 'WEEKLY_HOURS_ENABLED')?.VALOR
    : settings.WEEKLY_HOURS_ENABLED;
  if (raw === undefined || raw === null) return 'legacy';
  const value = Array.isArray(raw) ? raw.find((item) => item !== undefined && item !== null && item !== '') ?? '' : raw;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return 'weekly';
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return 'legacy';
  return 'unknown';
}
