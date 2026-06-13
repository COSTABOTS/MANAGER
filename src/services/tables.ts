import type { RestaurantTable, RestaurantTableType } from '../types';

type TableRow = Record<string, unknown>;

interface TablesResponse {
  success?: boolean;
  mesas?: TableRow[] | TableRow;
  tables?: TableRow[] | TableRow;
  data?: TableRow[] | TableRow;
  rows?: TableRow[] | TableRow;
}

interface SaveTablePayload {
  action: 'create' | 'update' | 'deactivate' | 'delete';
  table: RestaurantTable;
  clientId?: string;
}

function unwrapValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => item !== undefined && item !== null && item !== '') ?? '';
  }

  return value;
}

function pick(row: TableRow | undefined, keys: string[]) {
  for (const key of keys) {
    const value = unwrapValue(row?.[key]);
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
  const numberValue = Number(String(unwrapValue(value) ?? '').replace(',', '.'));
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function toBooleanValue(value: unknown) {
  const normalized = String(unwrapValue(value) ?? '').trim().toLowerCase();
  return ['true', '1', 'si', 'sí', 'yes', 'y', 'activa', 'activo'].includes(normalized);
}

function normalizeTableType(value: string): RestaurantTableType {
  const normalized = value.trim().toLowerCase();

  if (['general', 'interior', 'terraza', 'vip', 'barra', 'privado', 'otro'].includes(normalized)) {
    return normalized as RestaurantTableType;
  }

  return 'otro';
}

function normalizeRows(value: TableRow[] | TableRow | undefined) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getRows(data: TablesResponse | TableRow[]) {
  if (Array.isArray(data)) {
    return data;
  }

  return normalizeRows(data.tables ?? data.mesas ?? data.data ?? data.rows);
}

export function normalizeTableFromSheet(row: TableRow): RestaurantTable | null {
  const mesaId = toStringValue(pick(row, [
    'mesaId',
    'mesa_id',
    'MESA_ID',
    'MESA_ID (A)',
    'ID_MESA',
    'id_mesa',
    'id',
    'ID',
    '0',
  ]));
  const mesa = toStringValue(pick(row, ['mesa', 'MESA', 'MESA (B)', 'name', 'table', 'nombre', 'NOMBRE', '1']));

  if (!mesa) {
    return null;
  }

  const zonaValue = toStringValue(pick(row, ['zona', 'ZONA', 'ZONA (C)', 'type', 'tipo', 'TIPO', '2'])) || 'General';
  const zona = normalizeTableType(zonaValue);
  const capacidad = toNumberValue(pick(row, ['capacidad', 'CAPACIDAD', 'CAPACIDAD (D)', 'capacity', 'limite', 'LIMITE', '3']));
  const activeValue = pick(row, ['activa', 'ACTIVA', 'active', 'activo', 'ACTIVO', '4']);
  const activa = activeValue === '' ? true : toBooleanValue(activeValue) || toStringValue(activeValue).toLowerCase() === 'sí';
  const orden = toNumberValue(pick(row, ['orden', 'ORDEN', 'ORDEN (F)', 'order', '5'])) || 999;

  return {
    id: mesaId || `mesa-${mesa.toLowerCase().replace(/\s+/g, '-')}`,
    name: mesa,
    type: zona,
    capacity: capacidad,
    active: activa,
    order: orden,
    mesaId: mesaId || `mesa-${mesa.toLowerCase().replace(/\s+/g, '-')}`,
    mesa,
    zona,
    activa,
  };
}

export async function loadRestaurantTables(webhookUrl: string, sheetId?: string, clientId?: string): Promise<RestaurantTable[]> {
  if (!webhookUrl.trim()) {
    throw new Error('Webhook de mesas no configurado');
  }

  const response = await fetch(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'get',
      accion: 'leer_mesas',
      sheet_id: sheetId ?? '',
      client_id: clientId ?? '',
      hoja: 'MESAS',
      sheet_name: 'MESAS',
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudieron cargar mesas (${response.status})`);
  }

  const data = (await response.json()) as TablesResponse | TableRow[];
  console.log('getMesas raw response', data);
  const rows = getRows(data);

  if (!Array.isArray(data) && data.success === false) {
    throw new Error('Respuesta de mesas no valida');
  }

  if (!Array.isArray(rows)) {
    throw new Error('Respuesta de mesas no valida');
  }

  const normalizedTables = rows
    .flatMap((row) => {
      const table = normalizeTableFromSheet(row);
      return table ? [table] : [];
    })
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name));

  console.log('getMesas normalized', normalizedTables);

  return normalizedTables;
}

export async function saveRestaurantTable(webhookUrl: string, payload: SaveTablePayload) {
  if (!webhookUrl.trim()) {
    throw new Error('Webhook guardar mesa no configurado');
  }

  const table = payload.table;

  const response = await fetch(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: payload.action,
      id_mesa: table.mesaId || table.id,
      mesa: table.name,
      zona: table.type,
      capacidad: table.capacity ?? '',
      activa: table.active,
      orden: table.order ?? '',
      client_id: payload.clientId ?? '',
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo guardar mesa (${response.status})`);
  }

  return response.json().catch(() => ({ ok: true }));
}
