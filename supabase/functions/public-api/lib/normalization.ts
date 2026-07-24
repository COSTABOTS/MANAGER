export type BookingService = 'DESAYUNO' | 'ALMUERZO' | 'CENA' | 'BALINESA';
export type PublicLanguage = 'es' | 'en';

export function toStringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function toNumberValue(value: unknown) {
  const parsed = Number(toStringValue(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'si', 'sí', 'yes', 'y', 'on', 'activo', 'activa', 'fully booked', 'cerrado', 'cerrada'].includes(toStringValue(value).toLowerCase());
}

export function normalizeText(value: unknown) {
  return toStringValue(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKey(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

export function normalizeDateKey(value: unknown) {
  const raw = toStringValue(value);
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`;
  }

  return raw;
}

export function normalizeTime(value: unknown) {
  const raw = toStringValue(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return '';
  }

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function normalizeService(value: unknown): BookingService {
  const normalized = normalizeKey(value);
  if (normalized.includes('desayuno') || normalized.includes('breakfast')) {
    return 'DESAYUNO';
  }
  if (normalized.includes('almuerzo') || normalized.includes('comida') || normalized.includes('lunch')) {
    return 'ALMUERZO';
  }
  if (normalized.includes('balinesa') || normalized.includes('balinese') || normalized.includes('daybed') || normalized.includes('hamaca')) {
    return 'BALINESA';
  }
  return 'CENA';
}

export function normalizeLanguage(value: unknown): PublicLanguage {
  const normalized = normalizeKey(value);
  if (['en', 'eng', 'english', 'ingles'].includes(normalized)) {
    return 'en';
  }

  return 'es';
}

export function normalizePhone(value: unknown) {
  const raw = toStringValue(value);
  const cleaned = raw.replace(/[\s().-]/g, '').replace(/^\+/, '');

  if (!/^\d{7,15}$/.test(cleaned)) {
    return '';
  }

  if (/^[67]\d{8}$/.test(cleaned)) {
    return `34${cleaned}`;
  }

  return cleaned;
}

export function rowsToObjects(values: unknown[][] | undefined) {
  if (!values?.length) {
    return [];
  }

  const headers = values[0].map((header) => toStringValue(header));

  return values.slice(1).flatMap((row, index) => {
    if (!row.some((cell) => toStringValue(cell))) {
      return [];
    }

    const item: Record<string, unknown> = { __ROW_INDEX__: index + 1 };
    row.forEach((cell, cellIndex) => {
      const value = toStringValue(cell);
      const header = headers[cellIndex];
      item[String(cellIndex)] = value;
      if (header) {
        item[header] = value;
        item[header.toUpperCase()] = value;
        item[header.toLowerCase()] = value;
        item[normalizeKey(header)] = value;
      }
    });

    return [item];
  });
}

export function pickValue(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key] ?? item[key.toUpperCase()] ?? item[key.toLowerCase()] ?? item[normalizeKey(key)];
    if (value !== undefined && value !== null && toStringValue(value) !== '') {
      return value;
    }
  }

  return '';
}
