export function formatDisplayDate(date: string) {
  if (date.includes('/')) {
    return date;
  }

  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export function normalizeDateForCompare(date: string) {
  const value = String(date ?? '').trim();
  const spanishDate = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (spanishDate) {
    const [, day, month, year] = spanishDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return value;
}

export function getCurrentTime(options: { includeSeconds?: boolean } = {}) {
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    ...(options.includeSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).format(new Date());
}

export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
