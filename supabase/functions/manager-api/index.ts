import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveReservationStore } from '../_shared/reservation-store/resolver.ts';
import { readOfficialReservationList } from './reservationListSource.ts';

type ManagerAction =
  | 'tables.list'
  | 'tables.create'
  | 'tables.update'
  | 'tables.delete'
  | 'resources.list'
  | 'resources.create'
  | 'resources.update'
  | 'resources.delete'
  | 'reservations.list'
  | 'feedbacks.list'
  | 'capacity.list'
  | 'capacity.save'
  | 'settings.get'
  | 'settings.save'
  | 'fullybooked.get'
  | 'fullybooked.set'
  | 'reservation.create'
  | 'reservation.arrive'
  | 'reservation.assignTable'
  | 'reservation.cancel'
  | 'walkin.create'
  | 'shows.list'
  | 'shows.save'
  | 'clients.list'
  | 'client.license.update'
  | 'client.branding.update';
type SheetRow = Record<string, string | number | boolean>;
type GoogleSheetsAppendResult = {
  updates?: {
    updatedRange?: string;
    updatedRows?: number;
    updatedColumns?: number;
    updatedCells?: number;
  };
};
type ManagerApiDebug = {
  hasAuthHeader: boolean;
  userId: string;
  profileFound: boolean;
  clientId: string;
  clientFound: boolean;
  hasSheetId: boolean;
  hasGoogleSecret: boolean;
  rowsRead: number;
};

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://manager.costabots.com',
]);

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';

  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://manager.costabots.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(request: Request, code: string, message: string, status = 400, debug: Record<string, unknown> = {}) {
  return jsonResponse(request, {
    ok: false,
    error: message,
    code,
    message,
    context: debug,
    debug,
  }, status);
}

function createDebug(): ManagerApiDebug {
  return {
    hasAuthHeader: false,
    userId: '',
    profileFound: false,
    clientId: '',
    clientFound: false,
    hasSheetId: false,
    hasGoogleSecret: Boolean(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')),
    rowsRead: 0,
  };
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n');
}

function stringToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function createGoogleAccessToken() {
  const serviceAccountJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');

  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SECRET_MISSING');
  }

  const serviceAccount = JSON.parse(serviceAccountJson) as {
    client_email?: string;
    private_key?: string;
  };

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('GOOGLE_SECRET_INVALID');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsignedJwt = `${base64UrlEncode(stringToBytes(JSON.stringify(header)))}.${base64UrlEncode(stringToBytes(JSON.stringify(claim)))}`;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(normalizePrivateKey(serviceAccount.private_key)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, stringToBytes(unsignedJwt));
  const jwt = `${unsignedJwt}.${base64UrlEncode(new Uint8Array(signature))}`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(`GOOGLE_AUTH_ERROR: ${tokenResponse.status}: ${errorBody}`);
  }

  const tokenData = await tokenResponse.json() as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error('GOOGLE_AUTH_ERROR: access_token missing');
  }

  return tokenData.access_token;
}

function normalizeBoolean(value: unknown) {
  return ['', 'true', '1', 'si', 'sí', 'yes', 'activa', 'activo'].includes(String(value ?? '').trim().toLowerCase());
}

function toSheetString(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function pickRecordValue(row: Record<string, unknown> | null | undefined, keys: string[]) {
  const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedEntries = Object.entries(row ?? {}).reduce<Record<string, unknown>>((items, [key, value]) => {
    items[normalizeKey(key)] = value;
    return items;
  }, {});

  for (const key of keys) {
    const value = row?.[key] ?? row?.[key.toLowerCase()] ?? row?.[key.toUpperCase()] ?? normalizedEntries[normalizeKey(key)];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return '';
}

function toSheetNumber(value: unknown) {
  const parsedNumber = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsedNumber) ? parsedNumber : 0;
}

function rowsToObjects(values: unknown[][] | undefined) {
  if (!values?.length) {
    return [];
  }

  const headers = values[0].map((header) => String(header ?? '').trim());

  return values.slice(1).flatMap((row) => {
    if (!row.some((cell) => String(cell ?? '').trim())) {
      return [];
    }

    const item: SheetRow = {};
    row.forEach((cell, index) => {
      const value = String(cell ?? '').trim();
      const header = headers[index];
      item[String(index)] = value;
      if (header) {
        item[header] = value;
        item[header.toUpperCase()] = value;
      }
    });

    return [item];
  });
}

function pick(item: SheetRow, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return '';
}

function normalizeTables(values: unknown[][] | undefined): SheetRow[] {
  if (!values?.length) {
    return [];
  }

  const headers = values[0].map((header) => String(header ?? '').trim());

  return values.slice(1).flatMap((row) => {
    if (!row.some((cell) => String(cell ?? '').trim())) {
      return [];
    }

    const item: SheetRow = {};
    row.forEach((cell, index) => {
      const value = String(cell ?? '').trim();
      const header = headers[index];
      item[String(index)] = value;
      if (header) {
        item[header] = value;
        item[header.toUpperCase()] = value;
      }
    });

    const mesaId = String(item.MESA_ID ?? item.ID_MESA ?? item['0'] ?? '').trim();
    const mesa = String(item.MESA ?? item['1'] ?? '').trim();
    const zona = String(item.ZONA ?? item['2'] ?? 'General').trim() || 'General';
    const capacidad = Number(String(item.CAPACIDAD ?? item['3'] ?? 0).replace(',', '.')) || 0;
    const activa = normalizeBoolean(item.ACTIVA ?? item['4'] ?? 'TRUE');
    const orden = Number(String(item.ORDEN ?? item['5'] ?? 999).replace(',', '.')) || 999;

    if (!mesa) {
      return [];
    }

    const id = mesaId || `mesa-${mesa.toLowerCase().replace(/\s+/g, '-')}`;
    return [{
      id,
      name: mesa,
      type: zona,
      zone: zona,
      capacity: capacidad,
      active: activa,
      order: orden,
      mesaId: id,
      mesa_id: id,
      mesa,
      zona,
      capacidad,
      activa,
      orden,
    }];
  });
}

function normalizeReservations(values: unknown[][] | undefined): SheetRow[] {
  return rowsToObjects(values).flatMap((item) => {
    const idReserva = toSheetString(pick(item, ['ID_RESERVA', 'id_reserva', 'idReserva', '0']));

    if (!idReserva) {
      return [];
    }

    const fecha = toSheetString(pick(item, ['FECHA', 'fecha', '1']));
    const hora = toSheetString(pick(item, ['HORA', 'hora', '2']));
    const nombre = toSheetString(pick(item, ['NOMBRE', 'nombre', '3']));
    const telefono = toSheetString(pick(item, ['TELEFONO', 'telefono', '4']));
    const pax = toSheetNumber(pick(item, ['PAX', 'pax', '5']));
    const idioma = toSheetString(pick(item, ['IDIOMA', 'idioma', '6']));
    const peticionEspecial = toSheetString(pick(item, ['PETICION_ESPECIAL', 'PETICION ESPECIAL', 'peticionEspecial', 'peticiones', '7']));
    const estado = toSheetString(pick(item, ['ESTADO', 'estado', '8']));
    const origen = toSheetString(pick(item, ['ORIGEN', 'origen', '9']));
    const mesa = toSheetString(pick(item, ['MESA', 'mesa', '10']));
    const llego = normalizeBoolean(pick(item, ['LLEGO', 'llego', '11']));
    const feedbackEnviado = normalizeBoolean(pick(item, ['FEEDBACK_ENVIADO', 'feedback_enviado', '12']));
    const habitacion = toSheetString(pick(item, ['HABITACION', 'habitacion', '13']));
    const servicio = toSheetString(pick(item, ['SERVICIO', 'servicio', 'service', '16'])) || 'CENA';
    const paqueteBalinesa = toSheetString(pick(item, ['PAQUETE BALINESA', 'PAQUETE_BALINESA', 'paqueteBalinesa', 'paquete_balinesa', '17']));
    const recurso = toSheetString(pick(item, ['RECURSO', 'recurso', 'resource', '18']));

    return [{
      id: idReserva,
      idReserva,
      id_reserva: idReserva,
      ID_RESERVA: idReserva,
      date: fecha,
      fecha,
      FECHA: fecha,
      time: hora,
      hora,
      HORA: hora,
      name: nombre,
      nombre,
      NOMBRE: nombre,
      phone: telefono,
      telefono,
      TELEFONO: telefono,
      pax,
      PAX: pax,
      language: idioma,
      idioma,
      IDIOMA: idioma,
      specialRequest: peticionEspecial,
      peticionEspecial,
      peticiones: peticionEspecial,
      PETICION_ESPECIAL: peticionEspecial,
      status: estado,
      estado,
      ESTADO: estado,
      origin: origen,
      origen,
      ORIGEN: origen,
      table: mesa,
      mesa,
      MESA: mesa,
      arrived: llego,
      llego,
      LLEGO: llego,
      feedbackEnviado,
      feedback_enviado: feedbackEnviado,
      room: habitacion,
      habitacion,
      HABITACION: habitacion,
      service: servicio,
      servicio,
      SERVICIO: servicio,
      balinesePackage: paqueteBalinesa,
      paqueteBalinesa,
      PAQUETE_BALINESA: paqueteBalinesa,
      resource: recurso,
      recurso,
      RECURSO: recurso,
    }];
  });
}

function normalizeCapacity(values: unknown[][] | undefined): SheetRow[] {
  return rowsToObjects(values).flatMap((item) => {
    const hora = toSheetString(pick(item, ['HORA', 'hora', 'TIME', 'time', '0']));

    if (!hora) {
      return [];
    }

    const limite = toSheetNumber(pick(item, ['LIMITE', 'limite', 'CAPACIDAD', 'capacity', '1']));
    const activo = normalizeBoolean(pick(item, ['ACTIVO', 'activo', 'ACTIVE', 'active', '2']));

    return [{
      hora,
      time: hora,
      HORA: hora,
      limite,
      capacity: limite,
      LIMITE: limite,
      activo,
      active: activo,
      ACTIVO: activo,
    }];
  });
}

function toRatingValue(value: unknown) {
  const rawValue = toSheetString(value);
  const starCount = Array.from(rawValue).filter((character) => character === '⭐').length;
  if (starCount > 0) {
    return Math.min(5, Math.max(1, starCount));
  }

  const rating = Number(rawValue.replace(',', '.'));
  return Number.isFinite(rating) ? Math.min(5, Math.max(0, Math.round(rating))) : 0;
}

function normalizeFeedbacks(values: unknown[][] | undefined): SheetRow[] {
  return rowsToObjects(values).flatMap((item, index) => {
    const fecha = toSheetString(pick(item, ['FECHA', 'fecha', 'DATE', 'date', '0']));
    const puntuacion = toRatingValue(pick(item, ['PUNTUACION', 'puntuacion', 'RATING', 'rating', '1']));
    const comentario = toSheetString(pick(item, ['COMENTARIO', 'comentario', 'COMMENT', 'comment', '2']));
    const cliente = toSheetString(pick(item, ['CLIENTE', 'cliente', 'NOMBRE', 'nombre', '4']));
    const habitacion = toSheetString(pick(item, ['HABITACION', 'habitacion', 'ROOM', 'room', '5']));
    const timestamp = toSheetString(pick(item, ['TIMESTAMP', 'timestamp', '6']));

    if (!fecha && !comentario && !cliente && puntuacion === 0) {
      return [];
    }

    const id = timestamp || `${fecha}-${cliente}-${index}`;
    return [{
      id,
      date: fecha,
      fecha,
      FECHA: fecha,
      rating: puntuacion,
      puntuacion,
      PUNTUACION: puntuacion,
      comment: comentario,
      comentario,
      COMENTARIO: comentario,
      client: cliente,
      cliente,
      CLIENTE: cliente,
      room: habitacion,
      habitacion,
      HABITACION: habitacion,
      timestamp,
      TIMESTAMP: timestamp,
    }];
  });
}

function normalizeSettings(values: unknown[][] | undefined): Record<string, string | number | boolean> {
  return rowsToObjects(values).reduce<Record<string, string | number | boolean>>((settings, item) => {
    const variable = toSheetString(pick(item, ['VARIABLE', 'variable', 'KEY', 'key', '0'])).toUpperCase();
    const value = pick(item, ['VALUE', 'value', 'VALOR', 'valor', '1']);

    if (variable) {
      settings[variable] = toSheetString(value);
    }

    return settings;
  }, {});
}

function normalizeSettingsInput(settings: unknown) {
  if (Array.isArray(settings)) {
    return settings.reduce<Record<string, string>>((items, row) => {
      if (!row || typeof row !== 'object') {
        return items;
      }

      const item = row as Record<string, unknown>;
      const variable = toSheetString(item.variable ?? item.VARIABLE ?? item.key ?? item.KEY).toUpperCase();
      const value = toSheetString(item.value ?? item.VALUE ?? item.valor ?? item.VALOR);

      if (variable) {
        items[variable] = value;
      }

      return items;
    }, {});
  }

  if (settings && typeof settings === 'object') {
    return Object.entries(settings as Record<string, unknown>).reduce<Record<string, string>>((items, [key, value]) => {
      const variable = toSheetString(key).toUpperCase();
      if (variable) {
        items[variable] = toSheetString(value);
      }

      return items;
    }, {});
  }

  return {};
}

function normalizeDateKey(value: unknown) {
  const date = toSheetString(value);
  const spanishDate = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (spanishDate) {
    const [, day, month, year] = spanishDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return date;
}

function formatSheetDate(value: unknown) {
  const date = toSheetString(value);
  const isoDate = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return `${day}/${month}/${year}`;
  }

  return date;
}

function getControlHeaders(values: unknown[][] | undefined) {
  const headers = values?.[0]?.map((header) => String(header ?? '').trim().toUpperCase()) ?? [];
  const findIndex = (candidates: string[], fallback: number) => {
    const index = headers.findIndex((header) => candidates.includes(header));
    return index >= 0 ? index : fallback;
  };

  return {
    date: findIndex(['FECHA', 'DATE'], 0),
    status: findIndex(['ESTADO', 'STATUS'], 1),
    fullyBooked: findIndex(['FULLY BOOKED', 'FULLY_BOOKED', 'FULLYBOOKED'], 2),
  };
}

function isFullyBookedValue(value: unknown) {
  const normalized = toSheetString(value).toLowerCase();
  return ['true', '1', 'si', 'sÃ­', 'yes', 'y', 'on', 'fully booked', 'cerrado', 'cerrada'].includes(normalized);
}

function findControlRow(values: unknown[][] | undefined, date: string) {
  if (!values?.length) {
    return { rowIndex: -1, headers: getControlHeaders(values) };
  }

  const headers = getControlHeaders(values);
  const targetDate = normalizeDateKey(date);

  for (let index = 1; index < values.length; index += 1) {
    if (normalizeDateKey(values[index]?.[headers.date]) === targetDate) {
      return { rowIndex: index, headers };
    }
  }

  return { rowIndex: -1, headers };
}

function getReservationHeaders(values: unknown[][] | undefined) {
  const headers = values?.[0]?.map((header) => String(header ?? '').trim().toUpperCase()) ?? [];
  const findIndex = (candidates: string[], fallback: number) => {
    const index = headers.findIndex((header) => candidates.includes(header));
    return index >= 0 ? index : fallback;
  };

  return {
    idReserva: findIndex(['ID_RESERVA', 'ID RESERVA'], 0),
    estado: findIndex(['ESTADO', 'STATUS'], 8),
    mesa: findIndex(['MESA'], 10),
    llego: findIndex(['LLEGO', 'LLEGÓ', 'ARRIVED'], 11),
  };
}

function findReservationRow(values: unknown[][] | undefined, idReserva: string) {
  if (!values?.length) {
    return { rowIndex: -1, headers: getReservationHeaders(values) };
  }

  const headers = getReservationHeaders(values);

  for (let index = 1; index < values.length; index += 1) {
    if (toSheetString(values[index]?.[headers.idReserva]) === idReserva) {
      return { rowIndex: index, headers };
    }
  }

  return { rowIndex: -1, headers };
}

function makeTableId() {
  return `MESA-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function makeResourceId() {
  return `BAL-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function makeReservationId() {
  return `RES-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function normalizeTableInput(table: Record<string, unknown> | undefined, mesaId: string) {
  const mesa = toSheetString(table?.mesa ?? table?.name ?? table?.MESA);
  const zona = toSheetString(table?.zona ?? table?.type ?? table?.ZONA) || 'General';
  const capacidad = toSheetNumber(table?.capacidad ?? table?.capacity ?? table?.CAPACIDAD);
  const rawActive = table?.activa ?? table?.active ?? table?.ACTIVA ?? true;
  const activa = typeof rawActive === 'boolean' ? rawActive : normalizeBoolean(rawActive);
  const orden = toSheetNumber(table?.orden ?? table?.order ?? table?.ORDEN) || '';

  if (!mesa) {
    throw new Error('TABLE_NAME_REQUIRED');
  }

  return {
    mesaId,
    mesa,
    zona,
    capacidad,
    activa,
    orden,
    values: [mesaId, mesa, zona, capacidad, activa ? 'TRUE' : 'FALSE', orden],
  };
}

function findTableRowIndex(values: unknown[][] | undefined, mesaId: string) {
  if (!values?.length) {
    return -1;
  }

  const headers = values[0].map((header) => String(header ?? '').trim().toUpperCase());
  const mesaIdColumn = Math.max(0, headers.findIndex((header) => ['MESA_ID', 'ID_MESA'].includes(header)));

  for (let index = 1; index < values.length; index += 1) {
    const value = toSheetString(values[index]?.[mesaIdColumn]);
    if (value === mesaId) {
      return index;
    }
  }

  return -1;
}

function normalizeResources(values: unknown[][] | undefined) {
  if (!values?.length) {
    return [];
  }

  const headers = values[0].map((header) => String(header ?? '').trim());
  const rows = values.slice(1).flatMap((valueRow) => {
    if (!valueRow.some((cell) => toSheetString(cell))) {
      return [];
    }

    const row: SheetRow = {};
    valueRow.forEach((cell, index) => {
      const value = toSheetString(cell);
      const header = headers[index];
      row[String(index)] = value;
      if (header) {
        row[header] = value;
        row[header.toUpperCase()] = value;
        row[header.toLowerCase()] = value;
      }
    });

    return [row];
  });

  return rows
    .flatMap((row) => {
      const recursoId = toSheetString(row.RECURSO_ID ?? row.recurso_id ?? row.ID_RECURSO ?? row.id ?? row[0]);
      const recurso = toSheetString(row.RECURSO ?? row.recurso ?? row.name ?? row.NOMBRE ?? row.nombre ?? row[1]);
      const zona = toSheetString(row.ZONA ?? row.zona ?? row.zone ?? row[2]) || 'General';
      const capacidad = toSheetNumber(row.CAPACIDAD ?? row.capacidad ?? row.capacity ?? row[3]);
      const activeValue = row.ACTIVA ?? row.activa ?? row.ACTIVO ?? row.activo ?? row.active ?? row[4];
      const activa = activeValue === undefined || activeValue === '' ? true : normalizeBoolean(activeValue);
      const orden = toSheetNumber(row.ORDEN ?? row.orden ?? row.order ?? row[5]) || 999;

      if (!recurso) {
        return [];
      }

      return [{
        id: recursoId || `RECURSO-${recurso}`,
        recursoId: recursoId || `RECURSO-${recurso}`,
        name: recurso,
        recurso,
        zone: zona,
        zona,
        capacity: capacidad,
        capacidad,
        active: activa,
        activa,
        order: orden,
        orden,
      }];
    })
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name));
}

function normalizeResourceInput(resource: Record<string, unknown> | undefined, recursoId: string) {
  const recurso = toSheetString(resource?.recurso ?? resource?.name ?? resource?.RECURSO);
  const zona = toSheetString(resource?.zona ?? resource?.zone ?? resource?.ZONA) || 'General';
  const capacidad = toSheetNumber(resource?.capacidad ?? resource?.capacity ?? resource?.CAPACIDAD);
  const rawActive = resource?.activa ?? resource?.active ?? resource?.ACTIVA ?? true;
  const activa = typeof rawActive === 'boolean' ? rawActive : normalizeBoolean(rawActive);
  const orden = toSheetNumber(resource?.orden ?? resource?.order ?? resource?.ORDEN) || '';

  if (!recurso) {
    throw new Error('RESOURCE_NAME_REQUIRED');
  }

  return {
    recursoId,
    recurso,
    zona,
    capacidad,
    activa,
    orden,
    values: [recursoId, recurso, zona, capacidad, activa ? 'TRUE' : 'FALSE', orden],
  };
}

function findResourceRowIndex(values: unknown[][] | undefined, recursoId: string) {
  if (!values?.length) {
    return -1;
  }

  const headers = values[0].map((header) => String(header ?? '').trim().toUpperCase());
  const recursoIdColumn = Math.max(0, headers.findIndex((header) => ['RECURSO_ID', 'ID_RECURSO'].includes(header)));

  for (let index = 1; index < values.length; index += 1) {
    const value = toSheetString(values[index]?.[recursoIdColumn]);
    if (value === recursoId) {
      return index;
    }
  }

  return -1;
}

function normalizeShowType(value: unknown) {
  return toSheetString(value).toLowerCase() === 'recurring' ? 'recurring' : 'single';
}

function normalizeShowRecord(show: Record<string, unknown>) {
  const id = toSheetString(show.id ?? show.show_id ?? show.showId);
  const name = toSheetString(show.nombre ?? show.name ?? show.NOMBRE);
  const type = normalizeShowType(show.tipo ?? show.type ?? show.TIPO);
  const date = toSheetString(show.fecha ?? show.date ?? show.FECHA);
  const weekday = toSheetString(show.dia ?? show.weekday ?? show.day ?? show.DIA);
  const time = toSheetString(show.hora ?? show.time ?? show.HORA);
  const activeRaw = show.activo ?? show.active ?? show.ACTIVO ?? true;
  const visibleRaw = show.visible_chatbot ?? show.visibleInChatbot ?? show.visible_chatbot ?? show.VISIBLE_CHATBOT ?? activeRaw;
  const reservableRaw = show.reservable ?? show.bookable ?? show.RESERVABLE ?? activeRaw;
  const order = toSheetNumber(show.orden ?? show.order ?? show.ORDEN);

  return {
    id,
    name,
    nombre: name,
    type,
    tipo: type,
    date,
    fecha: date,
    weekday,
    dia: weekday,
    time,
    hora: time,
    active: typeof activeRaw === 'boolean' ? activeRaw : normalizeBoolean(activeRaw),
    activo: typeof activeRaw === 'boolean' ? activeRaw : normalizeBoolean(activeRaw),
    visibleInChatbot: typeof visibleRaw === 'boolean' ? visibleRaw : normalizeBoolean(visibleRaw),
    visible_chatbot: typeof visibleRaw === 'boolean' ? visibleRaw : normalizeBoolean(visibleRaw),
    bookable: typeof reservableRaw === 'boolean' ? reservableRaw : normalizeBoolean(reservableRaw),
    reservable: typeof reservableRaw === 'boolean' ? reservableRaw : normalizeBoolean(reservableRaw),
    order,
    orden: order,
  };
}

function normalizeShowInput(show: Record<string, unknown> | undefined) {
  const normalized = normalizeShowRecord(show ?? {});

  if (!normalized.name) {
    throw new Error('SHOW_NAME_REQUIRED');
  }

  return normalized;
}

async function fetchSheetValues(sheetId: string, range: string, accessToken: string) {
  const sheetsResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!sheetsResponse.ok) {
    const errorBody = await sheetsResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${sheetsResponse.status}: ${errorBody}`);
  }

  return sheetsResponse.json() as Promise<{ values?: unknown[][] }>;
}

async function getSheetNumericId(sheetId: string, sheetTitle: string, accessToken: string) {
  const metadataResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets(properties(sheetId,title))`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!metadataResponse.ok) {
    const errorBody = await metadataResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${metadataResponse.status}: ${errorBody}`);
  }

  const metadata = await metadataResponse.json() as { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> };
  const sheet = metadata.sheets?.find((item) => item.properties?.title === sheetTitle);

  if (sheet?.properties?.sheetId === undefined) {
    throw new Error(`SHEET_NOT_FOUND: ${sheetTitle}`);
  }

  return sheet.properties.sheetId;
}

function columnLetter(index: number) {
  let column = '';
  let current = index + 1;

  while (current > 0) {
    const modulo = (current - 1) % 26;
    column = String.fromCharCode(65 + modulo) + column;
    current = Math.floor((current - modulo) / 26);
  }

  return column;
}

function normalizeLicenseStatus(value: unknown) {
  const status = toSheetString(value).toUpperCase();
  return ['ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED'].includes(status) ? status : 'ACTIVE';
}

function normalizeLicensePlan(value: unknown) {
  return toSheetString(value).toUpperCase() === 'PRO' ? 'PRO' : 'DEMO';
}

async function resolveOperationalContext(request: Request, body: Record<string, unknown>, debug: ManagerApiDebug) {
  const action = body.action ?? 'tables.list';
  const requestedClientId = body.effective_client_id ?? body.effectiveClientId ?? body.client_id;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  debug.hasAuthHeader = Boolean(authHeader);
  console.log('[MANAGER_API] authHeader exists', Boolean(authHeader));
  console.log('[MANAGER_API] token length', token.length);

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: errorResponse(request, 'SUPABASE_ENV_MISSING', 'Supabase env no configurado', 500, debug) };
  }

  if (!token) {
    return { error: errorResponse(request, 'UNAUTHENTICATED', 'Missing Authorization header', 200, debug) };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);

  if (userError || !userData.user) {
    return {
      error: errorResponse(request, 'INVALID_TOKEN', userError?.message || 'Invalid Supabase JWT', 200, {
        ...debug,
        supabase_error: userError?.message,
      }),
    };
  }
  debug.userId = userData.user.id;

  const dbClient = createClient(supabaseUrl, supabaseServiceRoleKey || supabaseAnonKey, {
    global: { headers: supabaseServiceRoleKey ? {} : { Authorization: authHeader } },
  });
  const { data: profile, error: profileError } = await dbClient
    .from('PROFILES')
    .select('client_id, role, status')
    .eq('user_id', userData.user.id)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (profileError || !profile?.client_id) {
    return {
      error: errorResponse(request, 'PROFILE_NOT_FOUND', 'Profile activo no encontrado', 403, {
        ...debug,
        user_id: userData.user.id,
        supabase_error: profileError?.message,
      }),
    };
  }
  debug.profileFound = true;
  const profileClientId = String(profile.client_id).trim();
  const profileRole = String(profile.role ?? '').trim().toUpperCase();
  const selectedClientId = String(requestedClientId ?? '').trim();
  console.log('[MANAGER_API][AUTH_CONTEXT]', {
    user_id: userData.user.id,
    profile_user_id: userData.user.id,
    profile_role: profileRole,
    profile_client_id: profileClientId,
    requested_client_id: selectedClientId,
  });
  const actionCanUseProfileClient = action === 'clients.list';
  if (profileRole === 'SUPER_ADMIN' && !selectedClientId && !actionCanUseProfileClient) {
    return {
      error: errorResponse(request, 'SUPER_ADMIN_CLIENT_REQUIRED', 'SUPER_ADMIN debe enviar client_id operativo', 200, {
        ...debug,
        profileClientId,
        role: profileRole,
      }),
    };
  }
  const targetClientId = profileRole === 'SUPER_ADMIN' && selectedClientId ? selectedClientId : profileClientId;
  console.log('[MANAGER_API][CLIENT_CONTEXT]', {
    profileClientId,
    selectedClientId,
    effectiveClientId: targetClientId,
    role: profileRole,
  });
  console.log('[MANAGER_API][TARGET_CLIENT]', {
    requested_client_id: selectedClientId,
    targetClientId,
    isSuperAdmin: profileRole === 'SUPER_ADMIN',
  });
  debug.clientId = targetClientId;

  const { data: clientSummary, error: clientSummaryError } = await dbClient
    .from('CLIENTES')
    .select('*')
    .eq('client_id', targetClientId)
    .maybeSingle();
  const { data: client, error: clientError } = await dbClient
    .from('CLIENTES')
    .select('*')
    .eq('client_id', targetClientId)
    .maybeSingle();
  console.log('CLIENT_DEBUG', {
    targetClientId,
    selectedClientId,
    profileClientId,
    profileRole,
    clientFound: !!client,
    clientError: clientError?.message,
    sheetId: client?.sheet_id,
    sheetIdType: typeof client?.sheet_id,
    sheetIdLength: typeof client?.sheet_id === 'string' ? client.sheet_id.length : undefined,
    rawClient: JSON.stringify(client),
  });
  const clientStatus = normalizeLicenseStatus(pickRecordValue(client as Record<string, unknown> | null, ['status', 'STATUS']));
  const clientPlan = normalizeLicensePlan(pickRecordValue(client as Record<string, unknown> | null, ['plan', 'PLAN']));
  const clientExpiresAt = toSheetString(pickRecordValue(client as Record<string, unknown> | null, ['expires_at', 'EXPIRES_AT', 'expiresAt']));
  const isLicenseInactive = clientStatus === 'SUSPENDED' || clientStatus === 'EXPIRED';

  if (clientError || !client) {
    const { data: diagnosticByClientId, error: diagnosticByClientIdError } = await dbClient
      .from('CLIENTES')
      .select('*')
      .eq('client_id', targetClientId);
    const { data: diagnosticFirstClients, error: diagnosticFirstClientsError } = await dbClient
      .from('CLIENTES')
      .select('client_id, rest_name, status')
      .limit(10);

    return {
      error: errorResponse(request, 'CLIENT_NOT_FOUND', 'Cliente no encontrado', 200, {
        ...debug,
        targetClientId,
        clientSummary,
        clientSummaryError: clientSummaryError?.message,
        clientStatus,
        diagnosticByClientId,
        diagnosticByClientIdError: diagnosticByClientIdError?.message,
        diagnosticFirstClients,
        diagnosticFirstClientsError: diagnosticFirstClientsError?.message,
        client_id: targetClientId,
        supabase_error: clientError?.message,
      }),
    };
  }
  debug.clientFound = true;
  const resolvedClient = {
    ...(clientSummary as Record<string, unknown> | null ?? {}),
    ...(client as Record<string, unknown>),
  };
  const resolvedSheetId = toSheetString(pickRecordValue(resolvedClient, [
    'sheet_id',
    'sheetId',
    'SHEET_ID',
    'googleSheetId',
    'google_sheet_id',
    'GOOGLE_SHEET_ID',
  ]));
  const resolvedReservationStore = toSheetString(pickRecordValue(resolvedClient, ['reservation_store', 'reservationStore'])) || 'sheets';
  const reservationShadowRead = normalizeBoolean(pickRecordValue(resolvedClient, ['reservation_shadow_read', 'reservationShadowRead']));

  debug.hasSheetId = Boolean(resolvedSheetId);
  console.log('[MANAGER_API][SHEET_ID_DIAGNOSTIC]', {
    action,
    profileRole,
    profileClientId,
    selectedClientId,
    targetClientId,
    clientLoaded: pickRecordValue(resolvedClient, ['client_id', 'CLIENT_ID']),
    sheetId: pickRecordValue(resolvedClient, ['sheet_id', 'sheetId', 'SHEET_ID']),
    resolvedSheetId,
    clientSummary,
    clientSummaryError: clientSummaryError?.message,
  });
  console.log('[MANAGER_API][CLIENT_LOADED]', {
    client_id: pickRecordValue(resolvedClient, ['client_id', 'CLIENT_ID']),
    rest_name: pickRecordValue(resolvedClient, ['rest_name', 'REST_NAME']),
    status: pickRecordValue(resolvedClient, ['status', 'STATUS']),
    sheet_id: resolvedSheetId,
  });

  const actionRequiresSheetId = !['client.license.update', 'client.branding.update', 'clients.list', 'shows.list', 'shows.save', 'settings.get', 'settings.save'].includes(String(action))
    && !(String(action) === 'reservations.list' && resolvedReservationStore.toLowerCase() === 'supabase');
  if (!resolvedSheetId && actionRequiresSheetId) {
    const sheetDebug = {
      ...debug,
      action,
      effectiveClientId: targetClientId,
      requestedClientId,
      selectedClientId,
      targetClientId,
      profileClientId,
      profileRole,
      clientLoaded: resolvedClient,
      clientFound: !!client,
      sheetId: client?.sheet_id,
      sheetIdType: typeof client?.sheet_id,
      sheetIdLength: typeof client?.sheet_id === 'string' ? client.sheet_id.length : undefined,
      rawClient: client,
      sheet_id: pickRecordValue(resolvedClient, ['sheet_id', 'sheetId', 'SHEET_ID']),
      contextSheetId: resolvedSheetId,
      clientSummary,
      clientSummaryError: clientSummaryError?.message,
    };
    console.log('[SHEET DEBUG]', sheetDebug);
    return { error: errorResponse(request, 'SHEET_ID_NOT_FOUND', 'Sheet ID no encontrado', 200, sheetDebug) };
  }

  return {
    user: userData.user,
    profile,
    client: resolvedClient,
    dbClient,
    clientId: targetClientId,
    sheetId: resolvedSheetId,
    reservationStore: resolvedReservationStore,
    reservationShadowRead,
    role: profileRole,
    serviceRoleAvailable: Boolean(supabaseServiceRoleKey),
    license: {
      status: clientStatus,
      plan: clientPlan,
      expires_at: clientExpiresAt,
    },
  };
}

async function listTables(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const { data, error } = await dbClient.from('restaurant_tables').select('id,legacy_table_id,label,zone,capacity,active,display_order').eq('client_id', clientId).order('display_order', { ascending: true });
    if (error) throw new Error(`SUPABASE_TABLES_READ_FAILED: ${error.message}`);
    const tables = (data ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id ?? ''), mesaId: String(row.legacy_table_id ?? row.id ?? ''), mesa_id: String(row.legacy_table_id ?? row.id ?? ''), mesa: String(row.label ?? ''), name: String(row.label ?? ''), zona: String(row.zone ?? ''), type: String(row.zone ?? ''), capacidad: Number(row.capacity ?? 0), capacity: Number(row.capacity ?? 0), activa: Boolean(row.active), active: Boolean(row.active), orden: Number(row.display_order ?? 0), order: Number(row.display_order ?? 0) }));
    if (!tables.length) return errorResponse(request, 'TABLES_EMPTY', 'No hay mesas activas en MESAS', 404, debug);
    return jsonResponse(request, { ok: true, action: 'tables.list', client_id: clientId, tables });
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'MESAS!A:Z', accessToken);
  debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
  const tables = normalizeTables(sheetsData.values);
  console.log(`[MANAGER_API] tables=${tables.length}`);

  if (!tables.length) {
    return errorResponse(request, 'TABLES_EMPTY', 'No hay mesas activas en MESAS', 404, debug);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'tables.list',
    client_id: clientId,
    tables,
  });
}

async function updateClientLicense(
  request: Request,
  context: {
    dbClient: ReturnType<typeof createClient>;
    clientId: string;
    role: string;
    serviceRoleAvailable?: boolean;
  },
  body: Record<string, unknown>,
) {
  if (context.role !== 'SUPER_ADMIN') {
    return errorResponse(request, 'FORBIDDEN', 'Solo SUPER_ADMIN puede actualizar licencias', 403, {
      action: 'client.license.update',
      clientId: context.clientId,
      role: context.role,
    });
  }

  if (!context.serviceRoleAvailable) {
    return errorResponse(request, 'SUPABASE_SERVICE_ROLE_MISSING', 'SUPABASE_SERVICE_ROLE_KEY no disponible para actualizar licencia', 500, {
      action: 'client.license.update',
      clientId: context.clientId,
      role: context.role,
    });
  }

  const license = (body.license && typeof body.license === 'object' ? body.license : body) as Record<string, unknown>;
  const status = normalizeLicenseStatus(license.status);
  const plan = normalizeLicensePlan(license.plan);
  const rawExpiresAt = license.expires_at ?? license.expiresAt;
  const expiresAt = rawExpiresAt === undefined || rawExpiresAt === null || toSheetString(rawExpiresAt) === ''
    ? null
    : toSheetString(rawExpiresAt);
  const payload = {
    status,
    plan,
    expires_at: expiresAt,
  };

  console.log('[CLIENT_LICENSE_UPDATE]', {
    targetClientId: context.clientId,
    payload,
  });

  const { data, error } = await context.dbClient
    .from('CLIENTES')
    .update(payload)
    .eq('client_id', context.clientId)
    .select('client_id, rest_name, status, plan, expires_at, sheet_id')
    .single();

  console.log('[CLIENT_LICENSE_UPDATE_RESULT]', {
    targetClientId: context.clientId,
    updatedClient: data,
    updateError: error,
  });

  if (error || !data) {
    return errorResponse(request, 'CLIENT_UPDATE_FAILED', error?.message || 'No se actualizo ninguna fila en CLIENTES', 200, {
      action: 'client.license.update',
      clientId: context.clientId,
      targetClientId: context.clientId,
      payload,
      updateError: error?.message,
    });
  }

  const updatedClient = data as Record<string, unknown>;
  return jsonResponse(request, {
    ok: true,
    action: 'client.license.update',
    client_id: context.clientId,
    client: updatedClient,
    license: {
      status: normalizeLicenseStatus(updatedClient.status),
      plan: normalizeLicensePlan(updatedClient.plan),
      expires_at: toSheetString(updatedClient.expires_at),
    },
  });
}

async function updateClientBranding(
  request: Request,
  context: {
    dbClient: ReturnType<typeof createClient>;
    clientId: string;
    role: string;
  },
  body: Record<string, unknown>,
) {
  if (context.role !== 'SUPER_ADMIN') {
    return errorResponse(request, 'FORBIDDEN', 'Solo SUPER_ADMIN puede actualizar branding', 403, {
      action: 'client.branding.update',
      clientId: context.clientId,
      role: context.role,
    });
  }

  const branding = (body.branding && typeof body.branding === 'object' ? body.branding : body) as Record<string, unknown>;
  const hasRestName = Object.prototype.hasOwnProperty.call(branding, 'rest_name')
    || Object.prototype.hasOwnProperty.call(branding, 'restName')
    || Object.prototype.hasOwnProperty.call(branding, 'restaurantName');
  const restName = toSheetString(branding.rest_name ?? branding.restName ?? branding.restaurantName);
  const primaryColor = toSheetString(branding.primary_color ?? branding.primaryColor);
  const logoUrl = toSheetString(branding.logo_url ?? branding.logoUrl ?? branding.restaurantLogoUrl);

  if (hasRestName && !restName) {
    return errorResponse(request, 'INVALID_REST_NAME', 'rest_name no puede estar vacio', 200, {
      action: 'client.branding.update',
      clientId: context.clientId,
    });
  }

  if (!/^#[0-9a-f]{6}$/i.test(primaryColor)) {
    return errorResponse(request, 'INVALID_PRIMARY_COLOR', 'primary_color no es un HEX valido', 200, {
      action: 'client.branding.update',
      clientId: context.clientId,
      primaryColor,
    });
  }

  if (logoUrl) {
    try {
      new URL(logoUrl);
    } catch (_error) {
      return errorResponse(request, 'INVALID_LOGO_URL', 'logo_url no es una URL valida', 200, {
        action: 'client.branding.update',
        clientId: context.clientId,
        logoUrl,
      });
    }
  }

  const payload: { primary_color: string; logo_url: string; rest_name?: string } = {
    primary_color: primaryColor,
    logo_url: logoUrl,
  };
  if (hasRestName) {
    payload.rest_name = restName;
  }

  console.log('[CLIENT_BRANDING_UPDATE]', {
    targetClientId: context.clientId,
    payload,
  });

  const { data, error } = await context.dbClient
    .from('CLIENTES')
    .update(payload)
    .eq('client_id', context.clientId)
    .select('client_id, rest_name, primary_color, logo_url, sheet_id, status, plan, expires_at, is_demo')
    .single();

  console.log('[CLIENT_BRANDING_UPDATE_RESULT]', {
    targetClientId: context.clientId,
    updatedClient: data,
    updateError: error,
  });

  if (error || !data) {
    return errorResponse(request, 'CLIENT_BRANDING_UPDATE_FAILED', error?.message || 'No se pudo actualizar branding', 200, {
      action: 'client.branding.update',
      clientId: context.clientId,
      payload,
      updateError: error?.message,
    });
  }

  return jsonResponse(request, {
    ok: true,
    action: 'client.branding.update',
    client_id: context.clientId,
    client: data,
  });
}

async function listClients(request: Request, context: { dbClient: ReturnType<typeof createClient>; role: string }) {
  if (context.role !== 'SUPER_ADMIN') {
    return errorResponse(request, 'FORBIDDEN', 'Solo SUPER_ADMIN puede listar clientes', 403, {
      action: 'clients.list',
      role: context.role,
    });
  }

  const { data, error } = await context.dbClient
    .from('CLIENTES')
    .select('client_id, rest_name, logo_url, primary_color, sheet_id, status, plan, expires_at, is_demo')
    .order('rest_name', { ascending: true });

  if (error) {
    return errorResponse(request, 'CLIENTS_LIST_FAILED', error.message, 200, {
      action: 'clients.list',
      supabase_error: error.message,
    });
  }

  return jsonResponse(request, {
    ok: true,
    action: 'clients.list',
    clients: (data ?? []).map((client: Record<string, unknown>) => ({
      client_id: toSheetString(client.client_id),
      rest_name: toSheetString(client.rest_name),
      logo_url: toSheetString(client.logo_url),
      primary_color: toSheetString(client.primary_color),
      sheet_id: toSheetString(client.sheet_id),
      status: normalizeLicenseStatus(client.status),
      plan: normalizeLicensePlan(client.plan),
      expires_at: toSheetString(client.expires_at),
      is_demo: Boolean(client.is_demo),
    })),
  });
}

async function createTable(request: Request, sheetId: string, reservationStore: unknown, dbClient: any, clientId: string, body: Record<string, unknown>) {
  const mesaId = makeTableId();
  const table = normalizeTableInput(body.table as Record<string, unknown> | undefined, mesaId);
  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const { error } = await dbClient.from('restaurant_tables').insert({ client_id: clientId, legacy_table_id: table.mesaId, label: table.mesa, zone: table.zona, capacity: table.capacidad, active: table.activa, display_order: table.orden });
    if (error) throw new Error(`SUPABASE_TABLE_CREATE_FAILED: ${error.message}`);
    return jsonResponse(request, { ok: true, action: 'tables.create', mesaId });
  }
  const accessToken = await createGoogleAccessToken();

  const appendResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('MESAS!A:F')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [table.values] }),
    },
  );

  if (!appendResponse.ok) {
    const errorBody = await appendResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${appendResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'tables.create',
    mesaId,
  });
}

async function updateTable(request: Request, sheetId: string, reservationStore: unknown, dbClient: any, clientId: string, body: Record<string, unknown>) {
  const mesaId = toSheetString(body.mesaId ?? body.mesa_id ?? body.id_mesa);
  console.log('[MANAGER_API][tables.update] mesaId', mesaId);
  if (!mesaId) {
    return errorResponse(request, 'MESA_ID_REQUIRED', 'MESA_ID requerido', 400);
  }

  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const { data: existing, error: lookupError } = await dbClient.from('restaurant_tables').select('id').eq('client_id', clientId).or(`id.eq.${mesaId},legacy_table_id.eq.${mesaId}`).maybeSingle();
    if (lookupError) throw new Error(`SUPABASE_TABLE_READ_FAILED: ${lookupError.message}`);
    if (!existing) return errorResponse(request, 'TABLE_NOT_FOUND', 'Mesa no encontrada', 404, { mesaId });
    const table = normalizeTableInput(body.table as Record<string, unknown> | undefined, mesaId);
    const { error } = await dbClient.from('restaurant_tables').update({ label: table.mesa, zone: table.zona, capacity: table.capacidad, active: table.activa, display_order: table.orden }).eq('client_id', clientId).eq('id', existing.id);
    if (error) throw new Error(`SUPABASE_TABLE_UPDATE_FAILED: ${error.message}`);
    return jsonResponse(request, { ok: true, action: 'tables.update' });
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'MESAS!A:Z', accessToken);
  const rowIndex = findTableRowIndex(sheetsData.values, mesaId);

  if (rowIndex < 1) {
    return errorResponse(request, 'TABLE_NOT_FOUND', 'Mesa no encontrada', 404, { mesaId });
  }

  const table = normalizeTableInput(body.table as Record<string, unknown> | undefined, mesaId);
  console.log('[MANAGER_API][tables.update] row found', rowIndex + 1);
  console.log('[MANAGER_API][tables.update] values written', table.values);
  const rowNumber = rowIndex + 1;
  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`MESAS!A${rowNumber}:F${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [table.values] }),
    },
  );

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${updateResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'tables.update',
  });
}

async function deleteTable(request: Request, sheetId: string, reservationStore: unknown, dbClient: any, clientId: string, body: Record<string, unknown>) {
  const mesaId = toSheetString(body.mesaId ?? body.mesa_id ?? body.id_mesa);
  if (!mesaId) {
    return errorResponse(request, 'MESA_ID_REQUIRED', 'MESA_ID requerido', 400);
  }

  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const { data: existing, error: lookupError } = await dbClient.from('restaurant_tables').select('id').eq('client_id', clientId).or(`id.eq.${mesaId},legacy_table_id.eq.${mesaId}`).maybeSingle();
    if (lookupError) throw new Error(`SUPABASE_TABLE_READ_FAILED: ${lookupError.message}`);
    if (!existing) return errorResponse(request, 'TABLE_NOT_FOUND', 'Mesa no encontrada', 404, { mesaId });
    const { error } = await dbClient.from('restaurant_tables').delete().eq('client_id', clientId).eq('id', existing.id);
    if (error) throw new Error(`SUPABASE_TABLE_DELETE_FAILED: ${error.message}`);
    return jsonResponse(request, { ok: true, action: 'tables.delete' });
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'MESAS!A:Z', accessToken);
  const rowIndex = findTableRowIndex(sheetsData.values, mesaId);

  if (rowIndex < 1) {
    return errorResponse(request, 'TABLE_NOT_FOUND', 'Mesa no encontrada', 404, { mesaId });
  }

  const numericSheetId = await getSheetNumericId(sheetId, 'MESAS', accessToken);
  const deleteResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: numericSheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      }),
    },
  );

  if (!deleteResponse.ok) {
    const errorBody = await deleteResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${deleteResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'tables.delete',
  });
}

async function listResources(request: Request, clientId: string, sheetId: string, debug: ManagerApiDebug) {
  console.log('[MANAGER_API] action=resources.list');
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'RECURSOS!A:F', accessToken);
  debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
  const resources = normalizeResources(sheetsData.values);
  console.log(`[MANAGER_API] resources=${resources.length}`);

  return jsonResponse(request, {
    ok: true,
    action: 'resources.list',
    client_id: clientId,
    resources,
  });
}

async function listShows(request: Request, context: { dbClient: ReturnType<typeof createClient>; clientId: string }) {
  console.log('[MANAGER_API] action=shows.list');
  console.log(`[MANAGER_API] client_id=${context.clientId}`);

  const { data, error } = await context.dbClient
    .from('SHOWS')
    .select('id, client_id, nombre, tipo, fecha, dia, hora, activo, visible_chatbot, reservable, orden')
    .eq('client_id', context.clientId)
    .order('orden', { ascending: true })
    .order('hora', { ascending: true });

  if (error) {
    return errorResponse(request, 'SHOWS_LIST_FAILED', error.message, 200, {
      action: 'shows.list',
      client_id: context.clientId,
      supabase_error: error.message,
    });
  }

  const shows = (data ?? []).map((show: Record<string, unknown>) => normalizeShowRecord(show));
  return jsonResponse(request, {
    ok: true,
    action: 'shows.list',
    client_id: context.clientId,
    shows,
  });
}

async function saveShow(request: Request, context: { dbClient: ReturnType<typeof createClient>; clientId: string }, body: Record<string, unknown>) {
  console.log('[MANAGER_API] action=shows.save');
  const show = normalizeShowInput(body.show as Record<string, unknown> | undefined);
  const payload = {
    client_id: context.clientId,
    nombre: show.name,
    tipo: show.type,
    fecha: show.type === 'single' ? show.date : '',
    dia: show.type === 'recurring' ? show.weekday : '',
    hora: show.time,
    activo: show.active,
    visible_chatbot: show.visibleInChatbot,
    reservable: show.bookable,
    orden: show.order || 0,
    updated_at: new Date().toISOString(),
  };

  const query = show.id
    ? context.dbClient
      .from('SHOWS')
      .update(payload)
      .eq('id', show.id)
      .eq('client_id', context.clientId)
      .select('id, client_id, nombre, tipo, fecha, dia, hora, activo, visible_chatbot, reservable, orden')
      .maybeSingle()
    : context.dbClient
      .from('SHOWS')
      .insert(payload)
      .select('id, client_id, nombre, tipo, fecha, dia, hora, activo, visible_chatbot, reservable, orden')
      .maybeSingle();

  const { data, error } = await query;

  if (error || !data) {
    return errorResponse(request, 'SHOW_SAVE_FAILED', error?.message || 'No se pudo guardar el show', 200, {
      action: 'shows.save',
      client_id: context.clientId,
      show_id: show.id,
      supabase_error: error?.message,
    });
  }

  return jsonResponse(request, {
    ok: true,
    action: 'shows.save',
    client_id: context.clientId,
    show: normalizeShowRecord(data as Record<string, unknown>),
  });
}

async function createResource(request: Request, sheetId: string, body: Record<string, unknown>) {
  const accessToken = await createGoogleAccessToken();
  const recursoId = makeResourceId();
  const resource = normalizeResourceInput(body.resource as Record<string, unknown> | undefined, recursoId);

  const appendResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('RECURSOS!A:F')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [resource.values] }),
    },
  );

  if (!appendResponse.ok) {
    const errorBody = await appendResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${appendResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'resources.create',
    recursoId,
  });
}

async function updateResource(request: Request, sheetId: string, body: Record<string, unknown>) {
  console.log('[MANAGER_API] action=resources.update');
  const recursoId = toSheetString(body.recursoId ?? body.recurso_id ?? body.id_recurso);
  if (!recursoId) {
    return errorResponse(request, 'RECURSO_ID_REQUIRED', 'RECURSO_ID requerido', 400);
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'RECURSOS!A:F', accessToken);
  const rowIndex = findResourceRowIndex(sheetsData.values, recursoId);

  if (rowIndex < 1) {
    return errorResponse(request, 'RESOURCE_NOT_FOUND', 'Recurso no encontrado', 404, { recursoId });
  }

  const resource = normalizeResourceInput(body.resource as Record<string, unknown> | undefined, recursoId);
  const rowNumber = rowIndex + 1;
  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`RECURSOS!A${rowNumber}:F${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [resource.values] }),
    },
  );

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${updateResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'resources.update',
  });
}

async function deleteResource(request: Request, sheetId: string, body: Record<string, unknown>) {
  console.log('[MANAGER_API] action=resources.delete');
  const recursoId = toSheetString(body.recursoId ?? body.recurso_id ?? body.id_recurso);
  if (!recursoId) {
    return errorResponse(request, 'RECURSO_ID_REQUIRED', 'RECURSO_ID requerido', 400);
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'RECURSOS!A:F', accessToken);
  const rowIndex = findResourceRowIndex(sheetsData.values, recursoId);

  if (rowIndex < 1) {
    return errorResponse(request, 'RESOURCE_NOT_FOUND', 'Recurso no encontrado', 404, { recursoId });
  }

  const numericSheetId = await getSheetNumericId(sheetId, 'RECURSOS', accessToken);
  const deleteResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: numericSheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      }),
    },
  );

  if (!deleteResponse.ok) {
    const errorBody = await deleteResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${deleteResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'resources.delete',
  });
}

async function listReservations(request: Request, clientId: string, sheetId: string, reservationStore: unknown, reservationShadowRead: boolean, dbClient: any, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  const readSheets = async () => {
    console.log(`[MANAGER_API] sheet_id=${sheetId}`);
    const accessToken = await createGoogleAccessToken();
    const sheetsResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('RESERVAS!A:Z')}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!sheetsResponse.ok) {
      const errorBody = await sheetsResponse.text();
      throw new Error(`GOOGLE_SHEETS_ERROR: ${sheetsResponse.status}: ${errorBody}`);
    }
    const sheetsData = await sheetsResponse.json() as { values?: unknown[][] };
    debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
    const reservations = normalizeReservations(sheetsData.values);
    console.log(`[MANAGER_API] reservations=${reservations.length}`);
    return reservations;
  };
  const readSupabase = async () => {
    const store = resolveReservationStore({ clientId, sheetId, reservationStore: 'supabase' }, {}, dbClient);
    return await store.listReservations();
  };
  const officialReservations = await readOfficialReservationList({
    reservationStore: String(reservationStore || 'sheets'),
    reservationShadowRead,
    readSheets,
    readSupabase,
    runShadow: async () => undefined,
  });
  const reservations = officialReservations.map(toManagerReservation);

  return jsonResponse(request, {
    ok: true,
    action: 'reservations.list',
    client_id: clientId,
    reservations,
  });
}

function toManagerReservation(reservation: unknown) {
  return reservation;
}

async function listCapacity(request: Request, clientId: string, sheetId: string, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const accessToken = await createGoogleAccessToken();
  const sheetsResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('CAPACIDAD!A:C')}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!sheetsResponse.ok) {
    const errorBody = await sheetsResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${sheetsResponse.status}: ${errorBody}`);
  }

  const sheetsData = await sheetsResponse.json() as { values?: unknown[][] };
  debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
  const capacity = normalizeCapacity(sheetsData.values);
  console.log(`[MANAGER_API] capacity rows=${capacity.length}`);

  return jsonResponse(request, {
    ok: true,
    action: 'capacity.list',
    client_id: clientId,
    capacity,
  });
}

async function saveCapacity(request: Request, clientId: string, sheetId: string, body: Record<string, unknown>) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const rawCapacity = Array.isArray(body.capacity)
    ? body.capacity
    : Array.isArray(body.slots)
      ? body.slots
      : [];

  const rows = rawCapacity.flatMap((slot) => {
    if (!slot || typeof slot !== 'object') {
      return [];
    }

    const row = slot as Record<string, unknown>;
    const hora = toSheetString(row.hora ?? row.time ?? row.HORA ?? row.TIME);
    const limite = toSheetNumber(row.limite ?? row.capacity ?? row.CAPACIDAD ?? row.LIMITE);
    const rawActive = row.activo ?? row.active ?? row.ACTIVO ?? row.ACTIVE ?? limite > 0;
    const activo = typeof rawActive === 'boolean' ? rawActive : normalizeBoolean(rawActive);

    if (!hora) {
      return [];
    }

    return [[hora, limite, activo ? 'TRUE' : 'FALSE']];
  });

  const accessToken = await createGoogleAccessToken();
  const clearResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('CAPACIDAD!A:C')}:clear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );

  if (!clearResponse.ok) {
    const errorBody = await clearResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${clearResponse.status}: ${errorBody}`);
  }

  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('CAPACIDAD!A1:C')}`
    + '?valueInputOption=USER_ENTERED',
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [['HORA', 'LIMITE', 'ACTIVO'], ...rows],
      }),
    },
  );

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${updateResponse.status}: ${errorBody}`);
  }

  console.log(`[MANAGER_API] capacity rows saved=${rows.length}`);

  return jsonResponse(request, {
    ok: true,
    action: 'capacity.save',
    client_id: clientId,
    rows: rows.length,
  });
}

async function listFeedbacks(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const { data: feedbackRows, error: feedbackError } = await dbClient
      .from('feedbacks')
      .select('id,reservation_id,legacy_reservation_id,rating,comment,submitted_at,created_at')
      .eq('client_id', clientId)
      .order('submitted_at', { ascending: false });
    if (feedbackError) throw new Error(`SUPABASE_FEEDBACKS_READ_FAILED: ${feedbackError.message}`);
    const { data: reservationRows, error: reservationError } = await dbClient
      .from('reservations')
      .select('id,legacy_reservation_id,customer_name,room')
      .eq('client_id', clientId);
    if (reservationError) throw new Error(`SUPABASE_FEEDBACK_RESERVATIONS_READ_FAILED: ${reservationError.message}`);
    const reservationsById = new Map((reservationRows ?? []).map((row: Record<string, unknown>) => [String(row.id ?? ''), row]));
    const reservationsByLegacyId = new Map((reservationRows ?? []).filter((row: Record<string, unknown>) => row.legacy_reservation_id).map((row: Record<string, unknown>) => [String(row.legacy_reservation_id), row]));
    const feedbacks = (feedbackRows ?? []).map((row: Record<string, unknown>) => {
      const reservation = reservationsById.get(String(row.reservation_id ?? '')) ?? reservationsByLegacyId.get(String(row.legacy_reservation_id ?? ''));
      const submittedAt = String(row.submitted_at ?? row.created_at ?? '');
      const date = submittedAt ? submittedAt.slice(0, 10) : '';
      return {
        id: String(row.id ?? row.legacy_reservation_id ?? ''), date, fecha: date, FECHA: date,
        rating: Number(row.rating ?? 0), puntuacion: Number(row.rating ?? 0), PUNTUACION: Number(row.rating ?? 0),
        comment: String(row.comment ?? ''), comentario: String(row.comment ?? ''), COMENTARIO: String(row.comment ?? ''),
        client: String(reservation?.customer_name ?? ''), cliente: String(reservation?.customer_name ?? ''), CLIENTE: String(reservation?.customer_name ?? ''),
        room: String(reservation?.room ?? ''), habitacion: String(reservation?.room ?? ''), HABITACION: String(reservation?.room ?? ''),
        timestamp: submittedAt, TIMESTAMP: submittedAt,
      };
    });
    debug.rowsRead = feedbacks.length;
    return jsonResponse(request, { ok: true, action: 'feedbacks.list', client_id: clientId, feedbacks });
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'FEEDBACKS!A:Z', accessToken);
  debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
  const feedbacks = normalizeFeedbacks(sheetsData.values);
  console.log(`[MANAGER_API] feedbacks=${feedbacks.length}`);

  return jsonResponse(request, {
    ok: true,
    action: 'feedbacks.list',
    client_id: clientId,
    feedbacks,
  });
}

async function getSettings(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const { data, error } = await dbClient.from('SETTINGS').select('CLAVE,VALOR').eq('CLIENTE_ID', clientId).order('id', { ascending: true });
    if (error) throw new Error(`SUPABASE_SETTINGS_READ_FAILED: ${error.message}`);
    debug.rowsRead = Array.isArray(data) ? data.length : 0;
    const settings = normalizeSettings((data ?? []).map((row: Record<string, unknown>) => [row.CLAVE, row.VALOR]));
    return jsonResponse(request, { ok: true, action: 'settings.get', client_id: clientId, settings });
  }
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const accessToken = await createGoogleAccessToken();
  const sheetsResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('SETTINGS!A:Z')}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!sheetsResponse.ok) {
    const errorBody = await sheetsResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${sheetsResponse.status}: ${errorBody}`);
  }

  const sheetsData = await sheetsResponse.json() as { values?: unknown[][] };
  debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
  const settings = normalizeSettings(sheetsData.values);
  console.log('[MANAGER_API] settings loaded');

  return jsonResponse(request, {
    ok: true,
    action: 'settings.get',
    client_id: clientId,
    settings,
  });
}

async function saveSettings(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const settingsMap = normalizeSettingsInput(body.settings);
    const variables = Object.keys(settingsMap);
    if (variables.length === 0) return errorResponse(request, 'SETTINGS_REQUIRED', 'No se recibieron SETTINGS para guardar', 400);
    for (const variable of variables) {
      const value = settingsMap[variable];
      const { data, error } = await dbClient.from('SETTINGS').update({ VALOR: value }).eq('CLIENTE_ID', clientId).eq('CLAVE', variable).select('id');
      if (error) throw new Error(`SUPABASE_SETTINGS_WRITE_FAILED: ${error.message}`);
      if (!Array.isArray(data) || data.length === 0) {
        const { error: insertError } = await dbClient.from('SETTINGS').insert({ CLIENTE_ID: clientId, CLAVE: variable, VALOR: value });
        if (insertError) throw new Error(`SUPABASE_SETTINGS_WRITE_FAILED: ${insertError.message}`);
      }
    }
    return jsonResponse(request, { ok: true, action: 'settings.save', client_id: clientId });
  }
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const settingsMap = normalizeSettingsInput(body.settings);
  const variables = Object.keys(settingsMap);

  if (variables.length === 0) {
    return errorResponse(request, 'SETTINGS_REQUIRED', 'No se recibieron SETTINGS para guardar', 400);
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'SETTINGS!A:Z', accessToken);
  const existingValues = sheetsData.values ?? [];
  debug.rowsRead = Math.max(0, existingValues.length - 1);

  const headerRow = existingValues[0]?.length ? existingValues[0].map((cell) => toSheetString(cell)) : ['VARIABLE', 'VALUE'];
  const normalizedHeaders = headerRow.map((header) => header.trim().toUpperCase());
  const variableColumn = Math.max(0, normalizedHeaders.findIndex((header) => ['VARIABLE', 'KEY'].includes(header)));
  const valueColumn = Math.max(1, normalizedHeaders.findIndex((header) => ['VALUE', 'VALOR'].includes(header)));
  const width = Math.max(headerRow.length, variableColumn + 1, valueColumn + 1, 2);

  const nextValues = existingValues.length
    ? existingValues.map((row) => [...row])
    : [headerRow];

  nextValues[0] = [...headerRow];
  while (nextValues[0].length < width) {
    nextValues[0].push('');
  }
  if (!nextValues[0][variableColumn]) {
    nextValues[0][variableColumn] = 'VARIABLE';
  }
  if (!nextValues[0][valueColumn]) {
    nextValues[0][valueColumn] = 'VALUE';
  }

  const rowByVariable = new Map<string, number>();
  for (let index = 1; index < nextValues.length; index += 1) {
    const variable = toSheetString(nextValues[index]?.[variableColumn]).toUpperCase();
    if (variable) {
      rowByVariable.set(variable, index);
    }
  }

  variables.forEach((variable) => {
    const existingRowIndex = rowByVariable.get(variable);
    const row = existingRowIndex === undefined ? [] : [...nextValues[existingRowIndex]];

    while (row.length < width) {
      row.push('');
    }

    row[variableColumn] = variable;
    row[valueColumn] = settingsMap[variable];

    if (existingRowIndex === undefined) {
      nextValues.push(row);
    } else {
      nextValues[existingRowIndex] = row;
    }
  });

  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('SETTINGS!A1:Z')}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: nextValues }),
    },
  );

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${updateResponse.status}: ${errorBody}`);
  }

  console.log(`[MANAGER_API] settings saved=${variables.length}`);

  return jsonResponse(request, {
    ok: true,
    action: 'settings.save',
    client_id: clientId,
  });
}

async function getFullyBooked(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const date = toSheetString(body.date ?? body.fecha);
  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const { data, error } = await dbClient
      .from('booking_day_controls')
      .select('fully_booked,status')
      .eq('client_id', clientId)
      .eq('booking_date', normalizeDateKey(date))
      .is('service', null)
      .maybeSingle();
    if (error) throw new Error(`SUPABASE_FULLY_BOOKED_READ_FAILED: ${error.message}`);
    return jsonResponse(request, { ok: true, action: 'fullybooked.get', client_id: clientId, date, fullyBooked: Boolean(data?.fully_booked) || String(data?.status ?? '').toLowerCase() === 'closed' });
  }
  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, "'CONTROL RESERVAS'!A:D", accessToken);
  debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
  const { rowIndex, headers } = findControlRow(sheetsData.values, date);
  const row = rowIndex >= 0 ? sheetsData.values?.[rowIndex] : undefined;
  const fullyBooked = row ? isFullyBookedValue(row[headers.fullyBooked]) || isFullyBookedValue(row[headers.status]) : false;

  return jsonResponse(request, {
    ok: true,
    action: 'fullybooked.get',
    client_id: clientId,
    date,
    fullyBooked,
  });
}

async function setFullyBooked(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const date = toSheetString(body.date ?? body.fecha);
  const fullyBooked = Boolean(body.fullyBooked ?? body.fully_booked);

  if (!date) {
    return errorResponse(request, 'DATE_REQUIRED', 'Fecha requerida', 400);
  }

  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const bookingDate = normalizeDateKey(date);
    const { data: existing, error: readError } = await dbClient
      .from('booking_day_controls')
      .select('id')
      .eq('client_id', clientId)
      .eq('booking_date', bookingDate)
      .is('service', null)
      .maybeSingle();
    if (readError) throw new Error(`SUPABASE_FULLY_BOOKED_READ_FAILED: ${readError.message}`);
    const values = { client_id: clientId, service: null, booking_date: bookingDate, status: fullyBooked ? 'closed' : 'open', fully_booked: fullyBooked };
    const result = existing?.id
      ? await dbClient.from('booking_day_controls').update(values).eq('client_id', clientId).eq('id', existing.id)
      : await dbClient.from('booking_day_controls').insert(values);
    if (result.error) throw new Error(`SUPABASE_FULLY_BOOKED_WRITE_FAILED: ${result.error.message}`);
    return jsonResponse(request, { ok: true, action: 'fullybooked.set', client_id: clientId, date, fullyBooked });
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, "'CONTROL RESERVAS'!A:D", accessToken);
  debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
  const { rowIndex, headers } = findControlRow(sheetsData.values, date);
  const statusValue = fullyBooked ? 'FULLY BOOKED' : 'RESERVAS ABIERTAS';
  const fullyBookedValue = fullyBooked ? 'TRUE' : 'FALSE';

  if (rowIndex >= 1) {
    const rowNumber = rowIndex + 1;
    const statusColumn = columnLetter(headers.status);
    const fullyBookedColumn = columnLetter(headers.fullyBooked);
    const updateResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: `'CONTROL RESERVAS'!${statusColumn}${rowNumber}`,
              values: [[statusValue]],
            },
            {
              range: `'CONTROL RESERVAS'!${fullyBookedColumn}${rowNumber}`,
              values: [[fullyBookedValue]],
            },
          ],
        }),
      },
    );

    if (!updateResponse.ok) {
      const errorBody = await updateResponse.text();
      throw new Error(`GOOGLE_SHEETS_ERROR: ${updateResponse.status}: ${errorBody}`);
    }
  } else {
    const appendResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent("'CONTROL RESERVAS'!A:D")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [[formatSheetDate(date), statusValue, fullyBookedValue, '']] }),
      },
    );

    if (!appendResponse.ok) {
      const errorBody = await appendResponse.text();
      throw new Error(`GOOGLE_SHEETS_ERROR: ${appendResponse.status}: ${errorBody}`);
    }
  }

  return jsonResponse(request, {
    ok: true,
    action: 'fullybooked.set',
    client_id: clientId,
    date,
    fullyBooked,
  });
}

async function updateReservationCell(
  request: Request,
  sheetId: string,
  idReserva: string,
  columnIndex: number,
  value: string,
  debug: ManagerApiDebug,
) {
  if (!idReserva) {
    return errorResponse(request, 'ID_RESERVA_REQUIRED', 'ID_RESERVA requerido', 400);
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'RESERVAS!A:Z', accessToken);
  debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
  const { rowIndex } = findReservationRow(sheetsData.values, idReserva);

  if (rowIndex < 1) {
    return errorResponse(request, 'RESERVATION_NOT_FOUND', 'Reserva no encontrada', 404, { idReserva });
  }

  console.log('[MANAGER_API][reservation.arrive] row found', rowIndex + 1);
  const rowNumber = rowIndex + 1;
  const column = columnLetter(columnIndex);
  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`RESERVAS!${column}${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [[value]] }),
    },
  );

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${updateResponse.status}: ${errorBody}`);
  }

  return null;
}

async function createReservation(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, body: Record<string, unknown>) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const reservation = (body.reservation ?? {}) as Record<string, unknown>;
  const idReserva = makeReservationId();
  console.log(`[MANAGER_API] idReserva=${idReserva}`);

  const nombre = toSheetString(reservation.nombre ?? reservation.name);
  const telefono = toSheetString(reservation.telefono ?? reservation.phone);
  const fecha = toSheetString(reservation.fecha ?? reservation.date);
  const hora = toSheetString(reservation.hora ?? reservation.time);
  const pax = toSheetNumber(reservation.pax);
  const habitacion = toSheetString(reservation.habitacion ?? reservation.room);
  const idioma = toSheetString(reservation.idioma ?? reservation.language) || 'ES';
  const peticionEspecial = toSheetString(reservation.peticionEspecial ?? reservation.peticiones ?? reservation.specialRequest) || 'No, ninguna';
  const origen = toSheetString(reservation.origen ?? reservation.origin) || 'MANUAL';
  const mesa = toSheetString(reservation.mesa ?? reservation.table);
  const rawServicio = toSheetString(reservation.servicio ?? reservation.service).toUpperCase();
  const servicio = ['DESAYUNO', 'ALMUERZO', 'CENA', 'BALINESA'].includes(rawServicio) ? rawServicio : 'CENA';
  const paqueteBalinesa = toSheetString(reservation.paqueteBalinesa ?? reservation.balinesePackage ?? reservation.paquete_balinesa);
  const recurso = toSheetString(reservation.recurso ?? reservation.resource);
  const rawArrival = reservation.llego ?? reservation.arrived ?? false;
  const llego = typeof rawArrival === 'boolean' ? rawArrival : normalizeBoolean(rawArrival);

  if (!fecha || !hora || !pax || (!nombre && !habitacion)) {
    return errorResponse(request, 'RESERVATION_REQUIRED_FIELDS', 'Faltan datos obligatorios para crear la reserva', 400);
  }

  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const store = resolveReservationStore({ clientId, sheetId, reservationStore: 'supabase' }, {}, dbClient);
    await store.createManualReservation({ id: idReserva, date: fecha, time: hora, name: nombre, phone: telefono, pax, language: idioma, specialRequest: peticionEspecial, status: 'CONFIRMADA', origin: 'MANUAL', table: mesa, arrived: llego, feedbackSent: false, room: habitacion, service: servicio, balinesePackage: paqueteBalinesa, resource: recurso });
    return jsonResponse(request, { ok: true, action: 'reservation.create', client_id: clientId, idReserva });
  }

  const rowToAppend = [
    idReserva,
    fecha,
    hora,
    nombre,
    telefono,
    pax,
    idioma,
    peticionEspecial,
    'CONFIRMADA',
    origen || 'MANUAL',
    mesa,
    llego ? 'TRUE' : 'FALSE',
    'FALSE',
    habitacion,
    '',
    '',
    servicio,
    paqueteBalinesa,
    recurso,
  ];
  console.log('[MANAGER_API][reservation.create] rowToAppend', rowToAppend);
  console.log('[MANAGER_API][reservation.create] row length', rowToAppend.length, 'Q index 16', rowToAppend[16], 'R index 17', rowToAppend[17], 'S index 18', rowToAppend[18]);

  const accessToken = await createGoogleAccessToken();
  const appendResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('RESERVAS!A:S')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [rowToAppend],
      }),
    },
  );

  if (!appendResponse.ok) {
    const errorBody = await appendResponse.text();
    console.error('[MANAGER_API][reservation.create] append error', {
      clientId,
      sheetId,
      range: 'RESERVAS!A:S',
      rowLength: rowToAppend.length,
      status: appendResponse.status,
      errorBody,
    });
    throw new Error(`GOOGLE_SHEETS_ERROR: ${appendResponse.status}: ${errorBody}`);
  }

  const appendResult = await appendResponse.json().catch(() => null) as GoogleSheetsAppendResult | null;
  console.log('[MANAGER_API][reservation.create] append confirmed', {
    clientId,
    sheetId,
    range: 'RESERVAS!A:S',
    rowLength: rowToAppend.length,
    updatedRange: appendResult?.updates?.updatedRange,
    updatedRows: appendResult?.updates?.updatedRows,
    updatedColumns: appendResult?.updates?.updatedColumns,
    updatedCells: appendResult?.updates?.updatedCells,
  });

  return jsonResponse(request, {
    ok: true,
    action: 'reservation.create',
    client_id: clientId,
    idReserva,
  });
}

async function createWalkIn(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, body: Record<string, unknown>) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const walkin = (body.walkin ?? {}) as Record<string, unknown>;
  console.log('[STEP3] walkin recibido', walkin);
  console.log('[STEP4] servicio recibido', walkin.servicio, walkin.service);
  const idReserva = makeReservationId();
  console.log(`[MANAGER_API] walkin idReserva=${idReserva}`);

  const nombre = toSheetString(walkin.nombre ?? walkin.name) || 'Walk-in';
  const fecha = toSheetString(walkin.fecha ?? walkin.date) || new Date().toISOString().slice(0, 10);
  const hora = toSheetString(walkin.hora ?? walkin.time) || new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const pax = toSheetNumber(walkin.pax);
  const habitacion = toSheetString(walkin.habitacion ?? walkin.room);
  const idioma = toSheetString(walkin.idioma ?? walkin.language) || 'ES';
  const peticionEspecial = toSheetString(walkin.peticionEspecial ?? walkin.peticiones ?? walkin.specialRequest);
  const mesa = toSheetString(walkin.mesa ?? walkin.table);
  const rawServicio = toSheetString(walkin.servicio ?? walkin.service).toUpperCase();
  const servicio = ['DESAYUNO', 'ALMUERZO', 'CENA', 'BALINESA'].includes(rawServicio) ? rawServicio : 'CENA';

  if (!pax) {
    return errorResponse(request, 'WALKIN_REQUIRED_FIELDS', 'Faltan pax para crear el walk-in', 400);
  }

  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const store = resolveReservationStore({ clientId, sheetId, reservationStore: 'supabase' }, {}, dbClient);
    await store.createWalkIn({ id: idReserva, date: fecha, time: hora, name: nombre, phone: '', pax, language: idioma, specialRequest: peticionEspecial, status: 'CONFIRMADA', origin: 'WALK-IN', table: mesa, arrived: true, feedbackSent: false, room: habitacion, service: servicio, balinesePackage: '', resource: '' });
    return jsonResponse(request, { ok: true, action: 'walkin.create', client_id: clientId, idReserva });
  }

  const rowToAppend = [
    idReserva,
    fecha,
    hora,
    nombre,
    '',
    pax,
    idioma,
    peticionEspecial,
    'CONFIRMADA',
    'WALK-IN',
    mesa,
    'TRUE',
    'FALSE',
    habitacion,
    '',
    '',
    servicio,
    '',
    '',
  ];
  console.log('[MANAGER_API][walkin.create] rowToAppend', rowToAppend);
  console.log('[MANAGER_API][walkin.create] row length', rowToAppend.length, 'Q index 16', rowToAppend[16], 'R index 17', rowToAppend[17], 'S index 18', rowToAppend[18]);
  console.log('[MANAGER_API][walkin.create][Q_TEST]', {
    action: 'walkin.create',
    rowLength: rowToAppend.length,
    appendRange: 'RESERVAS!A:S',
    servicioFinal: servicio,
    row16: rowToAppend[16],
    row17: rowToAppend[17],
    row18: rowToAppend[18],
  });

  const accessToken = await createGoogleAccessToken();
  const appendResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('RESERVAS!A:S')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [rowToAppend] }),
    },
  );

  if (!appendResponse.ok) {
    const errorBody = await appendResponse.text();
    console.error('[MANAGER_API][walkin.create] append error', {
      clientId,
      sheetId,
      range: 'RESERVAS!A:S',
      rowLength: rowToAppend.length,
      status: appendResponse.status,
      errorBody,
    });
    throw new Error(`GOOGLE_SHEETS_ERROR: ${appendResponse.status}: ${errorBody}`);
  }

  const appendResult = await appendResponse.json().catch(() => null) as GoogleSheetsAppendResult | null;
  console.log('[MANAGER_API][walkin.create] append confirmed', {
    clientId,
    sheetId,
    range: 'RESERVAS!A:S',
    rowLength: rowToAppend.length,
    updatedRange: appendResult?.updates?.updatedRange,
    updatedRows: appendResult?.updates?.updatedRows,
    updatedColumns: appendResult?.updates?.updatedColumns,
    updatedCells: appendResult?.updates?.updatedCells,
  });

  return jsonResponse(request, {
    ok: true,
    action: 'walkin.create',
    client_id: clientId,
    idReserva,
  });
}

async function updateReservationArrival(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const idReserva = toSheetString(body.idReserva ?? body.id_reserva ?? body.ID_RESERVA);
  const rawArrival = body.llego ?? body.arrived;
  const llego = typeof rawArrival === 'boolean' ? rawArrival : normalizeBoolean(rawArrival);
  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const store = resolveReservationStore({ clientId, sheetId, reservationStore: 'supabase' }, {}, dbClient);
    await store.updateArrival(idReserva, llego);
    return jsonResponse(request, { ok: true, action: 'reservation.arrive', client_id: clientId, idReserva, llego });
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'RESERVAS!A:Z', accessToken);
  const { rowIndex, headers } = findReservationRow(sheetsData.values, idReserva);

  if (rowIndex < 1) {
    return errorResponse(request, 'RESERVATION_NOT_FOUND', 'Reserva no encontrada', 404, { idReserva });
  }

  console.log('[MANAGER_API][reservation.assignTable] row found', rowIndex + 1);
  const rowNumber = rowIndex + 1;
  const column = columnLetter(headers.llego);
  const value = llego ? 'TRUE' : 'FALSE';
  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`RESERVAS!${column}${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [[value]] }),
    },
  );

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${updateResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'reservation.arrive',
    client_id: clientId,
    idReserva,
    llego,
  });
}

async function assignReservationTable(request: Request, clientId: string, sheetId: string, reservationStore: unknown, dbClient: any, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const idReserva = toSheetString(body.idReserva ?? body.id_reserva ?? body.ID_RESERVA);
  const mesa = toSheetString(body.mesa ?? body.table);
  if (String(reservationStore ?? 'sheets').trim().toLowerCase() === 'supabase') {
    const store = resolveReservationStore({ clientId, sheetId, reservationStore: 'supabase' }, {}, dbClient);
    await store.assignTable(idReserva, mesa);
    return jsonResponse(request, { ok: true, action: 'reservation.assignTable', client_id: clientId, idReserva, mesa });
  }
  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'RESERVAS!A:Z', accessToken);
  const { rowIndex, headers } = findReservationRow(sheetsData.values, idReserva);

  if (rowIndex < 1) {
    return errorResponse(request, 'RESERVATION_NOT_FOUND', 'Reserva no encontrada', 404, { idReserva });
  }

  const rowNumber = rowIndex + 1;
  const column = columnLetter(headers.mesa);
  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`RESERVAS!${column}${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [[mesa]] }),
    },
  );

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${updateResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'reservation.assignTable',
    client_id: clientId,
    idReserva,
    mesa,
  });
}

async function cancelReservation(request: Request, clientId: string, sheetId: string, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const idReserva = toSheetString(body.idReserva ?? body.id_reserva ?? body.ID_RESERVA);
  if (!idReserva) {
    return errorResponse(request, 'ID_RESERVA_REQUIRED', 'ID_RESERVA requerido', 400);
  }

  const accessToken = await createGoogleAccessToken();
  const sheetsData = await fetchSheetValues(sheetId, 'RESERVAS!A:Z', accessToken);
  debug.rowsRead = Math.max(0, (sheetsData.values?.length ?? 0) - 1);
  const { rowIndex, headers } = findReservationRow(sheetsData.values, idReserva);

  if (rowIndex < 1) {
    return errorResponse(request, 'RESERVATION_NOT_FOUND', 'Reserva no encontrada', 404, { idReserva });
  }

  console.log('[MANAGER_API][reservation.cancel] row found', rowIndex + 1);
  const rowNumber = rowIndex + 1;
  const column = columnLetter(headers.estado);
  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`RESERVAS!${column}${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [['CANCELADA']] }),
    },
  );

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${updateResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'reservation.cancel',
    client_id: clientId,
    idReserva,
  });
}

Deno.serve(async (request) => {
  console.log(
    '[MANAGER_API] KEY MODE:',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      ? 'SERVICE_ROLE'
      : 'ANON',
  );
  console.log(
    '[MANAGER_API] SERVICE ROLE AVAILABLE:',
    !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  );

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(request) });
  }

  const debug = createDebug();
  try {
    const body = await request.json().catch(() => ({})) as { action?: ManagerAction | string };
    const action = body.action ?? 'tables.list';
    console.log(`[MANAGER_API] action=${action}`);
    console.log('[MANAGER_API][REQUEST]', {
      action,
      requested_client_id: body.client_id,
      requested_effective_client_id: body.effective_client_id ?? body.effectiveClientId,
    });

    const context = await resolveOperationalContext(request, body as Record<string, unknown>, debug);
    if ('error' in context) {
      return context.error;
    }

    switch (action) {
      case 'tables.list':
        return await listTables(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, debug);

      case 'tables.create':
        return await createTable(request, context.sheetId, context.reservationStore, context.dbClient, context.clientId, body as Record<string, unknown>);

      case 'tables.update':
        return await updateTable(request, context.sheetId, context.reservationStore, context.dbClient, context.clientId, body as Record<string, unknown>);

      case 'tables.delete':
        return await deleteTable(request, context.sheetId, context.reservationStore, context.dbClient, context.clientId, body as Record<string, unknown>);

      case 'resources.list':
        return await listResources(request, context.clientId, context.sheetId, debug);

      case 'resources.create':
        return await createResource(request, context.sheetId, body as Record<string, unknown>);

      case 'resources.update':
        return await updateResource(request, context.sheetId, body as Record<string, unknown>);

      case 'resources.delete':
        return await deleteResource(request, context.sheetId, body as Record<string, unknown>);

      case 'reservations.list':
        return await listReservations(request, context.clientId, context.sheetId, context.reservationStore, context.reservationShadowRead, context.dbClient, debug);

      case 'feedbacks.list':
        return await listFeedbacks(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, debug);

      case 'capacity.list':
        return await listCapacity(request, context.clientId, context.sheetId, debug);

      case 'capacity.save':
        return await saveCapacity(request, context.clientId, context.sheetId, body as Record<string, unknown>);

      case 'settings.get':
        return await getSettings(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, debug);

      case 'settings.save':
        return await saveSettings(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, body as Record<string, unknown>, debug);

      case 'fullybooked.get':
        return await getFullyBooked(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, body as Record<string, unknown>, debug);

      case 'fullybooked.set':
        return await setFullyBooked(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, body as Record<string, unknown>, debug);

      case 'reservation.create':
        return await createReservation(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, body as Record<string, unknown>);

      case 'reservation.arrive':
        return await updateReservationArrival(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, body as Record<string, unknown>, debug);

      case 'reservation.assignTable':
        return await assignReservationTable(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, body as Record<string, unknown>, debug);

      case 'reservation.cancel':
        return await cancelReservation(request, context.clientId, context.sheetId, body as Record<string, unknown>, debug);

      case 'walkin.create':
        return await createWalkIn(request, context.clientId, context.sheetId, context.reservationStore, context.dbClient, body as Record<string, unknown>);

      case 'shows.list':
        return await listShows(request, context);

      case 'shows.save':
        return await saveShow(request, context, body as Record<string, unknown>);

      case 'clients.list':
        return await listClients(request, context);

      case 'client.license.update':
        return await updateClientLicense(request, context, body as Record<string, unknown>);

      case 'client.branding.update':
        return await updateClientBranding(request, context, body as Record<string, unknown>);

      default:
        return errorResponse(request, 'UNKNOWN_ACTION', `Accion no soportada: ${action}`, 400, { ...debug, action });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    const code = message.startsWith('GOOGLE_SECRET_MISSING') || message.startsWith('GOOGLE_SECRET_INVALID')
      ? 'GOOGLE_SECRET_MISSING'
      : message.startsWith('GOOGLE_AUTH_ERROR')
        ? 'GOOGLE_AUTH_ERROR'
        : message.startsWith('GOOGLE_SHEETS_ERROR')
          ? 'GOOGLE_SHEETS_ERROR'
          : 'MANAGER_API_ERROR';

    return errorResponse(request, code, message, 500, debug);
  }
});
