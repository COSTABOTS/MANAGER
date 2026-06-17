import type { RestaurantTable, RestaurantTableType } from '../types';
import { supabase } from '../lib/supabaseClient';

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

interface DirectSheetsTablesPayload {
  sheetId?: string;
  clientId?: string;
  clientConfig?: unknown;
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

function normalizeGoogleSheetsRows(values: unknown[][] | undefined) {
  if (!values?.length) {
    return [];
  }

  const headers = values[0].map((header) => toStringValue(header));

  return values.slice(1).flatMap((valueRow) => {
    if (!valueRow.some((cell) => toStringValue(cell))) {
      return [];
    }

    const row: TableRow = {};
    valueRow.forEach((cell, index) => {
      row[String(index)] = cell;
      const header = headers[index];
      if (header) {
        row[header] = cell;
        row[header.trim().toUpperCase()] = cell;
      }
    });

    return [row];
  });
}

async function loadTablesFromSheetsDirectLegacy({ sheetId, clientId }: DirectSheetsTablesPayload): Promise<RestaurantTable[]> {
  console.log('[DEMO][MESAS] client_id:', clientId ?? '');

  if (!sheetId?.trim()) {
    throw new Error('No hay sheet_id para leer mesas');
  }

  console.log('[DEMO][MESAS] sheet_id encontrado');

  const apiKey = '';
  if (!apiKey) {
    throw new Error('Lectura publica de Google Sheets desactivada en demo');
  }

  console.log('[DEMO][MESAS] usando lectura directa desde Sheets');
  const range = encodeURIComponent('MESAS!A:Z');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId.trim())}/values/${range}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`No se pudieron leer mesas desde Sheets (${response.status})`);
  }

  const data = (await response.json()) as { values?: unknown[][] };
  const rows = normalizeGoogleSheetsRows(data.values);
  console.log('[DEMO][MESAS] filas leídas:', rows.length);

  return rows
    .flatMap((row) => {
      const table = normalizeTableFromSheet(row);
      return table ? [table] : [];
    })
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name));
}

function normalizeGoogleSheetsRowsWithDebug(values: unknown[][] | undefined) {
  if (!values?.length) {
    return { headers: [] as string[], rows: [] as TableRow[] };
  }

  const headers = values[0].map((header) => toStringValue(header));
  const rows = values.slice(1).flatMap((valueRow) => {
    if (!valueRow.some((cell) => toStringValue(cell))) {
      return [];
    }

    const row: TableRow = {};
    valueRow.forEach((cell, index) => {
      row[String(index)] = cell;
      const header = headers[index];
      if (header) {
        row[header] = cell;
        row[header.trim().toUpperCase()] = cell;
      }
    });

    return [row];
  });

  return { headers, rows };
}

export async function loadTablesFromSheetsDirect({ sheetId, clientId, clientConfig }: DirectSheetsTablesPayload): Promise<RestaurantTable[]> {
  console.log('[DEMO][MESAS] modo demo activo');
  console.log('[DEMO][MESAS] clientConfig completo:', clientConfig);
  console.log('[DEMO][MESAS] client_id:', clientId ?? '');
  console.log('[DEMO][MESAS] sheet_id:', sheetId ?? '');

  if (!sheetId?.trim()) {
    console.log('DIRECT_SHEETS_ERROR');
    throw new Error('No hay sheet_id para leer mesas');
  }

  console.log('[DEMO][MESAS] sheet_id encontrado');

  const apiKey = '';
  console.log('[DEMO][MESAS] apiKey existe:', Boolean(apiKey));
  if (!apiKey) {
    console.log('DIRECT_SHEETS_ERROR');
    throw new Error('Lectura publica de Google Sheets desactivada en demo');
  }

  console.log('[DEMO][MESAS] usando lectura directa desde Sheets');
  const ranges = ['MESAS!A:Z', 'Mesas!A:Z', 'mesas!A:Z'];
  let values: unknown[][] | undefined;
  let lastError: unknown = null;

  for (const rangeValue of ranges) {
    const range = encodeURIComponent(rangeValue);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId.trim())}/values/${range}?key=${encodeURIComponent(apiKey)}`;
    console.log('[DEMO][MESAS] url:', url.replace(/key=[^&]+/, 'key=***'));

    try {
      const response = await fetch(url);
      console.log('[DEMO][MESAS] respuesta HTTP:', response.status, response.statusText);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error('[DEMO][MESAS] error Google Sheets:', { range: rangeValue, status: response.status, statusText: response.statusText, body: errorBody });
        lastError = new Error(`No se pudieron leer mesas desde Sheets (${response.status})`);
        continue;
      }

      const data = (await response.json()) as { values?: unknown[][] };
      values = data.values;
      console.log('[DEMO][MESAS] raw values:', values);
      break;
    } catch (error) {
      console.error('[DEMO][MESAS] error Google Sheets:', error);
      lastError = error;
    }
  }

  if (!values) {
    console.log('DIRECT_SHEETS_ERROR');
    throw lastError instanceof Error ? lastError : new Error('No se pudieron leer mesas desde Sheets');
  }

  const { headers, rows } = normalizeGoogleSheetsRowsWithDebug(values);
  console.log('[DEMO][MESAS] headers detectados:', headers);
  console.log('[DEMO][MESAS] filas leídas:', rows.length);
  console.log('[DEMO][MESAS] filas normalizadas:', rows);

  const tables = rows
    .flatMap((row) => {
      const table = normalizeTableFromSheet(row);
      return table ? [table] : [];
    })
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name));

  console.log('[DEMO][MESAS] mesas finales:', tables);

  if (!tables.length) {
    console.log('DIRECT_SHEETS_EMPTY');
    throw new Error('Lectura directa de MESAS devolvio 0 mesas');
  }

  console.log('DIRECT_SHEETS_OK');
  return tables;
}

export async function loadTablesFromSupabaseEdge({ sheetId, clientId, clientConfig }: DirectSheetsTablesPayload): Promise<RestaurantTable[]> {
  console.log('[DEMO][MANAGER_API] calling tables.list');
  console.log('[DEMO][MESAS] clientConfig completo:', clientConfig);
  console.log('[DEMO][MESAS] client_id:', clientId ?? '');
  console.log('[DEMO][MESAS] sheet_id:', sheetId ?? '');

  const { data, error } = await supabase.functions.invoke('manager-api', {
    body: { action: 'tables.list' },
  });
  console.log('[DEMO][MANAGER_API] response', data);

  if (error) {
    throw error;
  }

  const response = data as TablesResponse & { ok?: boolean; source?: string; code?: string; message?: string };
  if (!response?.ok) {
    throw new Error(response?.code || response?.message || 'manager-api tables.list no devolvio ok=true');
  }

  const rows = getRows(response);
  const tables = rows
    .flatMap((row) => {
      const table = normalizeTableFromSheet(row);
      return table ? [table] : [];
    })
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name));

  console.log('[DEMO][MANAGER_API] tables received', tables.length);

  if (!tables.length) {
    throw new Error('Edge Function get-tables devolvio 0 mesas');
  }

  return tables;
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
