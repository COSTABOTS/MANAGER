import { invokeManagerApi } from './managerApiClient';
import type { Show } from '../types';

interface ShowsListResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  shows?: Array<Record<string, unknown>>;
}

interface ShowSaveResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  show?: Record<string, unknown>;
}

function toStringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  const text = toStringValue(value).toLowerCase();
  if (!text) {
    return fallback;
  }

  return ['true', '1', 'si', 'sí', 'yes', 'activo', 'activa'].includes(text);
}

function normalizeShow(value: Record<string, unknown>): Show {
  const active = toBoolean(value.active ?? value.activo, true);
  const visibleInChatbot = toBoolean(value.visibleInChatbot ?? value.visible_chatbot, active);
  const bookable = toBoolean(value.bookable ?? value.reservable, active);
  const type = toStringValue(value.type ?? value.tipo) === 'recurring' ? 'recurring' : 'single';

  return {
    id: toStringValue(value.id),
    name: toStringValue(value.name ?? value.nombre),
    type,
    date: toStringValue(value.date ?? value.fecha) || undefined,
    weekday: toStringValue(value.weekday ?? value.dia) as Show['weekday'],
    time: toStringValue(value.time ?? value.hora),
    active,
    visibleInChatbot,
    bookable,
  };
}

function showToApiPayload(show: Show) {
  return {
    id: show.id.startsWith('show-') ? '' : show.id,
    name: show.name,
    nombre: show.name,
    type: show.type,
    tipo: show.type,
    date: show.date ?? '',
    fecha: show.date ?? '',
    weekday: show.weekday ?? '',
    dia: show.weekday ?? '',
    time: show.time,
    hora: show.time,
    active: show.active,
    activo: show.active,
    visibleInChatbot: show.visibleInChatbot,
    visible_chatbot: show.visibleInChatbot,
    bookable: show.bookable,
    reservable: show.bookable,
  };
}

export async function loadShowsFromManagerApi() {
  const data = await invokeManagerApi<ShowsListResponse>({ action: 'shows.list' });

  if (!data?.ok || !Array.isArray(data.shows)) {
    throw new Error(data?.code || data?.message || 'No se pudieron cargar shows');
  }

  return data.shows.map(normalizeShow);
}

export async function saveShowWithManagerApi(show: Show) {
  const data = await invokeManagerApi<ShowSaveResponse>({
    action: 'shows.save',
    show: showToApiPayload(show),
  });

  if (!data?.ok || !data.show) {
    throw new Error(data?.code || data?.message || 'No se pudo guardar el show');
  }

  return normalizeShow(data.show);
}
