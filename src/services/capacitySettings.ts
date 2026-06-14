type CapacityRow = Record<string, unknown>;
type SlotCapacity = Record<string, number>;

interface CapacityResponse {
  ok?: boolean;
  success?: boolean;
  capacity?: CapacityRow[] | CapacityRow;
  capacidad?: CapacityRow[] | CapacityRow;
  slots?: CapacityRow[] | CapacityRow;
  data?: CapacityRow[] | CapacityRow;
  rows?: CapacityRow[] | CapacityRow;
  tables?: CapacityRow[] | CapacityRow;
}

function unwrapValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => item !== undefined && item !== null && item !== '') ?? '';
  }

  return value;
}

function pick(row: CapacityRow, keys: string[]) {
  for (const key of keys) {
    const value = unwrapValue(row[key]);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return '';
}

function toStringValue(value: unknown) {
  const unwrappedValue = unwrapValue(value);
  return unwrappedValue === undefined || unwrappedValue === null ? '' : String(unwrappedValue).trim();
}

function toNumberValue(value: unknown) {
  const numberValue = Number(toStringValue(value).replace(',', '.'));
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function toBooleanValue(value: unknown) {
  const normalized = toStringValue(value).toLowerCase();

  if (!normalized) {
    return true;
  }

  return ['true', '1', 'si', 'sí', 'yes', 'y', 'on', 'activo', 'activa'].includes(normalized);
}

function asRows(value: CapacityResponse['capacity']) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return [value];
  }

  return [];
}

export function normalizeCapacityRows(rows: CapacityRow[] | CapacityRow | undefined): SlotCapacity {
  return asRows(rows).reduce<SlotCapacity>((slots, row) => {
    const time = toStringValue(pick(row, ['time', 'TIME', 'HORA', 'hora', 'HORA (A)', 'TIME (A)', '0']));
    const capacity = toNumberValue(pick(row, ['capacity', 'CAPACITY', 'CAPACIDAD', 'capacidad', 'LIMITE', 'limite', 'LIMITE (B)', 'CAPACIDAD (B)', 'CAPACITY (B)', '1']));
    const active = toBooleanValue(pick(row, ['active', 'ACTIVE', 'ACTIVO', 'activo', 'ACTIVO (C)', 'ACTIVE (C)', '2']));

    if (time) {
      slots[time] = active ? capacity : 0;
    }

    return slots;
  }, {});
}

export async function loadCapacitySettings(webhookUrl: string) {
  if (!webhookUrl.trim()) {
    throw new Error('Webhook de capacidad no configurado');
  }

  const response = await fetch(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_capacity' }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo cargar CAPACIDAD (${response.status})`);
  }

  const data = (await response.json()) as CapacityResponse | CapacityRow[];
  console.log('CAPACITY raw response:', data);

  if (!Array.isArray(data) && (data.ok === false || data.success === false)) {
    throw new Error('Respuesta CAPACIDAD no valida');
  }

  const normalized = normalizeCapacityRows(Array.isArray(data) ? data : data.capacity ?? data.capacidad ?? data.rows ?? data.data ?? data.tables ?? data.slots);
  console.log('CAPACITY normalized:', normalized);

  return normalized;
}
