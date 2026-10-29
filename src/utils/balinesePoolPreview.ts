const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MADRID_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export type BalinesePoolDraft = { enabled: boolean; openingTime: string; closingTime: string };
export type BalineseCutoffResult = 'ALLOWED_BY_CUTOFF' | 'PAST_DATE' | 'CLOSED_TODAY' | 'INVALID_SCHEDULE';
export type BalineseDraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function emptyBalinesePoolDraft(): BalinesePoolDraft {
  return { enabled: false, openingTime: '', closingTime: '' };
}

export function balinesePoolStorageKey(clientId: string): string {
  return `costabots.balinese-pool-preview.v1:${clientId}`;
}

export function parseBalinesePoolDraft(value: unknown): BalinesePoolDraft | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.enabled !== 'boolean' || typeof source.openingTime !== 'string' || typeof source.closingTime !== 'string') return null;
  if (source.openingTime && !TIME_PATTERN.test(source.openingTime)) return null;
  if (source.closingTime && !TIME_PATTERN.test(source.closingTime)) return null;
  return { enabled: source.enabled, openingTime: source.openingTime, closingTime: source.closingTime };
}

export function loadBalinesePoolDraft(clientId: string, storage: BalineseDraftStorage): BalinesePoolDraft {
  if (!clientId) return emptyBalinesePoolDraft();
  try {
    const saved = storage.getItem(balinesePoolStorageKey(clientId));
    return saved ? parseBalinesePoolDraft(JSON.parse(saved)) ?? emptyBalinesePoolDraft() : emptyBalinesePoolDraft();
  } catch {
    return emptyBalinesePoolDraft();
  }
}

export function saveBalinesePoolDraft(clientId: string, draft: BalinesePoolDraft, storage: BalineseDraftStorage): void {
  if (!clientId) return;
  storage.setItem(balinesePoolStorageKey(clientId), JSON.stringify(draft));
}

export function isValidPoolHours(openingTime: string, closingTime: string): boolean {
  return TIME_PATTERN.test(openingTime) && TIME_PATTERN.test(closingTime) && openingTime < closingTime;
}

function madridParts(instant: Date) {
  const parts = Object.fromEntries(MADRID_FORMATTER.formatToParts(instant).map(({ type, value }) => [type, value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  return { year, month, day, hour, minute, second, date: `${parts.year}-${parts.month}-${parts.day}` };
}

function validDateKey(date: string): boolean {
  const match = DATE_PATTERN.exec(date);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function madridClosingInstant(date: string, closingTime: string): Date | null {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = closingTime.split(':').map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = new Date(localAsUtc + delta * 60 * 60 * 1000);
    const local = madridParts(sample);
    offsets.add(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - sample.getTime());
  }
  const matches = [...offsets].map((offset) => new Date(localAsUtc - offset)).filter((candidate) => {
    const local = madridParts(candidate);
    return local.date === date && local.hour === hour && local.minute === minute && local.second === 0;
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Only the date/cutoff gate. ALLOWED_BY_CUTOFF does not imply capacity or availability. */
export function evaluateBalinesePoolCutoff(
  bookingDate: string,
  openingTime: string,
  closingTime: string,
  now: Date = new Date(),
): BalineseCutoffResult {
  if (!validDateKey(bookingDate) || !isValidPoolHours(openingTime, closingTime) || Number.isNaN(now.getTime())) return 'INVALID_SCHEDULE';
  const today = madridParts(now).date;
  if (bookingDate < today) return 'PAST_DATE';
  if (bookingDate > today) return 'ALLOWED_BY_CUTOFF';
  const closingInstant = madridClosingInstant(bookingDate, closingTime);
  if (!closingInstant) return 'INVALID_SCHEDULE';
  return now.getTime() < closingInstant.getTime() ? 'ALLOWED_BY_CUTOFF' : 'CLOSED_TODAY';
}
