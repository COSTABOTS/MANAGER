import { supabase } from '../lib/supabaseClient';
import type { ReservableResource } from '../types';
import { invokeManagerApi } from './managerApiClient';

type ResourceAction = 'create' | 'update' | 'delete';
type ResourceRow = Record<string, unknown>;

interface ResourcesResponse {
  ok?: boolean;
  source?: string;
  code?: string;
  message?: string;
  resources?: ResourceRow[] | ResourceRow;
  recursos?: ResourceRow[] | ResourceRow;
  data?: ResourceRow[] | ResourceRow;
  rows?: ResourceRow[] | ResourceRow;
}

interface DirectResourcesPayload {
  sheetId?: string;
  clientId?: string;
  clientConfig?: unknown;
}

interface SaveResourcePayload {
  action: ResourceAction;
  resource: ReservableResource;
}

function unwrapValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => item !== undefined && item !== null && item !== '') ?? '';
  }

  return value;
}

function pick(row: ResourceRow | undefined, keys: string[]) {
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

function normalizeRows(value: ResourceRow[] | ResourceRow | undefined) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getRows(data: ResourcesResponse | ResourceRow[]) {
  if (Array.isArray(data)) {
    return data;
  }

  return normalizeRows(data.resources ?? data.recursos ?? data.data ?? data.rows);
}

function normalizeResourceFromSheet(row: ResourceRow): ReservableResource | null {
  const recursoId = toStringValue(pick(row, [
    'recursoId',
    'recurso_id',
    'RECURSO_ID',
    'RECURSO_ID (A)',
    'ID_RECURSO',
    'id_recurso',
    'id',
    'ID',
    '0',
  ]));
  const recurso = toStringValue(pick(row, ['recurso', 'RECURSO', 'RECURSO (B)', 'name', 'nombre', 'NOMBRE', '1']));

  if (!recurso) {
    return null;
  }

  const zona = toStringValue(pick(row, ['zona', 'ZONA', 'ZONA (C)', 'zone', '2'])) || 'General';
  const capacidad = toNumberValue(pick(row, ['capacidad', 'CAPACIDAD', 'CAPACIDAD (D)', 'capacity', '3']));
  const activeValue = pick(row, ['activa', 'ACTIVA', 'active', 'activo', 'ACTIVO', '4']);
  const activa = activeValue === '' ? true : toBooleanValue(activeValue);
  const orden = toNumberValue(pick(row, ['orden', 'ORDEN', 'ORDEN (F)', 'order', '5'])) || 999;

  return {
    id: recursoId || `recurso-${recurso.toLowerCase().replace(/\s+/g, '-')}`,
    recursoId: recursoId || `recurso-${recurso.toLowerCase().replace(/\s+/g, '-')}`,
    name: recurso,
    recurso,
    zone: zona,
    zona,
    capacity: capacidad,
    active: activa,
    activa,
    order: orden,
  };
}

export async function loadResourcesWithManagerApi({ sheetId, clientId, clientConfig }: DirectResourcesPayload = {}): Promise<ReservableResource[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  console.log('[DEMO][MANAGER_API] session exists', Boolean(session));
  console.log('[DEMO][MANAGER_API] token exists', Boolean(session?.access_token));
  console.log('[DEMO][MANAGER_API] calling resources.list');
  console.log('[DEMO][RECURSOS] clientConfig completo:', clientConfig);
  console.log('[DEMO][RECURSOS] client_id:', clientId ?? '');
  console.log('[DEMO][RECURSOS] sheet_id:', sheetId ?? '');

  const data = await invokeManagerApi<ResourcesResponse>({ action: 'resources.list' });
  console.log('[DEMO][MANAGER_API] data:', data);
  console.log('[DEMO][MANAGER_API] error:', null);
  console.log('[DEMO][MANAGER_API] raw data:', data);
  console.log('[DEMO][MANAGER_API] raw error:', null);
  console.log('[DEMO][MANAGER_API] ok:', (data as { ok?: boolean } | null)?.ok);
  console.log('[DEMO][MANAGER_API] resources:', (data as { resources?: unknown[] } | null)?.resources);
  console.log('[DEMO][MANAGER_API] resources length:', (data as { resources?: unknown[] } | null)?.resources?.length);

  const response = data as ResourcesResponse;
  if (!response?.ok) {
    throw new Error(response?.code || response?.message || 'manager-api resources.list no devolvio ok=true');
  }

  const rows = getRows(response);
  console.log('[DEMO][RESOURCES] before setResources:', rows);
  const mappedResources = rows
    .flatMap((row) => {
      const resource = normalizeResourceFromSheet(row);
      return resource ? [resource] : [];
    })
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name));
  console.log('[DEMO][RESOURCES] mapped resources:', mappedResources);
  console.log('[DEMO][RESOURCES] mapped length:', mappedResources?.length);

  console.log('[DEMO][MANAGER_API] resources received', mappedResources.length);

  return mappedResources;
}

export async function saveResourceWithManagerApi(payload: SaveResourcePayload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  console.log('[DEMO][MANAGER_API] session exists', Boolean(session));
  console.log('[DEMO][MANAGER_API] token exists', Boolean(session?.access_token));
  const resource = payload.resource;
  const managerAction =
    payload.action === 'create'
      ? 'resources.create'
      : payload.action === 'delete'
        ? 'resources.delete'
        : 'resources.update';
  const requestBody = {
    action: managerAction,
    recursoId: resource.recursoId || resource.id,
    resource: {
      recurso: resource.name,
      zona: resource.zone,
      capacidad: resource.capacity ?? 0,
      activa: resource.active,
      orden: resource.order ?? '',
    },
  };

  if (managerAction !== 'resources.create' && !(resource.recursoId || resource.id)) {
    throw new Error('RECURSO_ID requerido');
  }

  if (managerAction === 'resources.update') {
    console.log('[DEMO][RESOURCES] update payload', requestBody);
  }

  const data = await invokeManagerApi<{ ok?: boolean; code?: string; message?: string }>(requestBody);

  const response = data as { ok?: boolean; code?: string; message?: string };
  if (!response?.ok) {
    throw new Error(response?.code || response?.message || `${managerAction} no devolvio ok=true`);
  }

  if (managerAction === 'resources.update') {
    console.log('[DEMO][RESOURCES] update response', response);
  }

  if (managerAction === 'resources.create') {
    console.log('[DEMO][RESOURCES] created');
  } else if (managerAction === 'resources.delete') {
    console.log('[DEMO][RESOURCES] deleted');
  } else {
    console.log('[DEMO][RESOURCES] updated');
  }

  return response;
}
