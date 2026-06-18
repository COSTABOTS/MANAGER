import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ManagerAction =
  | 'tables.list'
  | 'tables.create'
  | 'tables.update'
  | 'tables.delete'
  | 'reservations.list'
  | 'capacity.list'
  | 'settings.get'
  | 'fullybooked.get'
  | 'fullybooked.set'
  | 'reservation.create'
  | 'reservation.arrive'
  | 'reservation.assignTable'
  | 'reservation.cancel'
  | 'walkin.create';
type SheetRow = Record<string, string | number | boolean>;
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
  return jsonResponse(request, { ok: false, code, message, debug }, status);
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

async function getAuthedClientContext(request: Request, debug: ManagerApiDebug) {
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
  debug.clientId = String(profile.client_id).trim();

  const { data: client, error: clientError } = await dbClient
    .from('CLIENTES')
    .select('client_id, sheet_id, rest_name, status')
    .eq('client_id', String(profile.client_id).trim())
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (clientError || !client) {
    return {
      error: errorResponse(request, 'CLIENT_NOT_FOUND', 'Cliente no encontrado', 404, {
        ...debug,
        client_id: profile.client_id,
        supabase_error: clientError?.message,
      }),
    };
  }
  debug.clientFound = true;
  debug.hasSheetId = Boolean(client.sheet_id);

  if (!client.sheet_id) {
    return { error: errorResponse(request, 'SHEET_ID_NOT_FOUND', 'Sheet ID no encontrado', 404, debug) };
  }

  return {
    user: userData.user,
    profile,
    client,
    clientId: String(client.client_id),
    sheetId: String(client.sheet_id),
  };
}

async function listTables(request: Request, clientId: string, sheetId: string, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

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

async function createTable(request: Request, sheetId: string, body: Record<string, unknown>) {
  const accessToken = await createGoogleAccessToken();
  const mesaId = makeTableId();
  const table = normalizeTableInput(body.table as Record<string, unknown> | undefined, mesaId);

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

async function updateTable(request: Request, sheetId: string, body: Record<string, unknown>) {
  const mesaId = toSheetString(body.mesaId ?? body.mesa_id ?? body.id_mesa);
  console.log('[MANAGER_API][tables.update] mesaId', mesaId);
  if (!mesaId) {
    return errorResponse(request, 'MESA_ID_REQUIRED', 'MESA_ID requerido', 400);
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

async function deleteTable(request: Request, sheetId: string, body: Record<string, unknown>) {
  const mesaId = toSheetString(body.mesaId ?? body.mesa_id ?? body.id_mesa);
  if (!mesaId) {
    return errorResponse(request, 'MESA_ID_REQUIRED', 'MESA_ID requerido', 400);
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

async function listReservations(request: Request, clientId: string, sheetId: string, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
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

  return jsonResponse(request, {
    ok: true,
    action: 'reservations.list',
    client_id: clientId,
    reservations,
  });
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

async function getSettings(request: Request, clientId: string, sheetId: string, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
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

async function getFullyBooked(request: Request, clientId: string, sheetId: string, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const date = toSheetString(body.date ?? body.fecha);
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

async function setFullyBooked(request: Request, clientId: string, sheetId: string, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const date = toSheetString(body.date ?? body.fecha);
  const fullyBooked = Boolean(body.fullyBooked ?? body.fully_booked);

  if (!date) {
    return errorResponse(request, 'DATE_REQUIRED', 'Fecha requerida', 400);
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

async function createReservation(request: Request, clientId: string, sheetId: string, body: Record<string, unknown>) {
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
  const rawArrival = reservation.llego ?? reservation.arrived ?? false;
  const llego = typeof rawArrival === 'boolean' ? rawArrival : normalizeBoolean(rawArrival);

  if (!fecha || !hora || !pax || (!nombre && !habitacion)) {
    return errorResponse(request, 'RESERVATION_REQUIRED_FIELDS', 'Faltan datos obligatorios para crear la reserva', 400);
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
  ];
  console.log('[MANAGER_API][reservation.create] rowToAppend', rowToAppend);

  const accessToken = await createGoogleAccessToken();
  const appendResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('RESERVAS!A:N')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
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
    throw new Error(`GOOGLE_SHEETS_ERROR: ${appendResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'reservation.create',
    client_id: clientId,
    idReserva,
  });
}

async function createWalkIn(request: Request, clientId: string, sheetId: string, body: Record<string, unknown>) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const walkin = (body.walkin ?? {}) as Record<string, unknown>;
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

  if (!pax) {
    return errorResponse(request, 'WALKIN_REQUIRED_FIELDS', 'Faltan pax para crear el walk-in', 400);
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
  ];
  console.log('[MANAGER_API][walkin.create] rowToAppend', rowToAppend);

  const accessToken = await createGoogleAccessToken();
  const appendResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('RESERVAS!A:N')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
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
    throw new Error(`GOOGLE_SHEETS_ERROR: ${appendResponse.status}: ${errorBody}`);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'walkin.create',
    client_id: clientId,
    idReserva,
  });
}

async function updateReservationArrival(request: Request, clientId: string, sheetId: string, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const idReserva = toSheetString(body.idReserva ?? body.id_reserva ?? body.ID_RESERVA);
  const rawArrival = body.llego ?? body.arrived;
  const llego = typeof rawArrival === 'boolean' ? rawArrival : normalizeBoolean(rawArrival);
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

async function assignReservationTable(request: Request, clientId: string, sheetId: string, body: Record<string, unknown>, debug: ManagerApiDebug) {
  console.log(`[MANAGER_API] client_id=${clientId}`);
  console.log(`[MANAGER_API] sheet_id=${sheetId}`);

  const idReserva = toSheetString(body.idReserva ?? body.id_reserva ?? body.ID_RESERVA);
  const mesa = toSheetString(body.mesa ?? body.table);
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
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(request) });
  }

  const debug = createDebug();
  try {
    const body = await request.json().catch(() => ({})) as { action?: ManagerAction | string };
    const action = body.action ?? 'tables.list';
    console.log(`[MANAGER_API] action=${action}`);

    const context = await getAuthedClientContext(request, debug);
    if ('error' in context) {
      return context.error;
    }

    switch (action) {
      case 'tables.list':
        return await listTables(request, context.clientId, context.sheetId, debug);

      case 'tables.create':
        return await createTable(request, context.sheetId, body as Record<string, unknown>);

      case 'tables.update':
        return await updateTable(request, context.sheetId, body as Record<string, unknown>);

      case 'tables.delete':
        return await deleteTable(request, context.sheetId, body as Record<string, unknown>);

      case 'reservations.list':
        return await listReservations(request, context.clientId, context.sheetId, debug);

      case 'capacity.list':
        return await listCapacity(request, context.clientId, context.sheetId, debug);

      case 'settings.get':
        return await getSettings(request, context.clientId, context.sheetId, debug);

      case 'fullybooked.get':
        return await getFullyBooked(request, context.clientId, context.sheetId, body as Record<string, unknown>, debug);

      case 'fullybooked.set':
        return await setFullyBooked(request, context.clientId, context.sheetId, body as Record<string, unknown>, debug);

      case 'reservation.create':
        return await createReservation(request, context.clientId, context.sheetId, body as Record<string, unknown>);

      case 'reservation.arrive':
        return await updateReservationArrival(request, context.clientId, context.sheetId, body as Record<string, unknown>, debug);

      case 'reservation.assignTable':
        return await assignReservationTable(request, context.clientId, context.sheetId, body as Record<string, unknown>, debug);

      case 'reservation.cancel':
        return await cancelReservation(request, context.clientId, context.sheetId, body as Record<string, unknown>, debug);

      case 'walkin.create':
        return await createWalkIn(request, context.clientId, context.sheetId, body as Record<string, unknown>);

      // TODO: feedbacks.list

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
