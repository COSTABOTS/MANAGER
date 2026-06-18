import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ManagerAction = 'tables.list' | 'reservations.list' | 'capacity.list';
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
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
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

    if (!mesa || !activa) {
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
    .select('client_id, sheet_id, rest_name')
    .eq('client_id', String(profile.client_id).trim())
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
  const sheetsResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent('MESAS!A:Z')}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!sheetsResponse.ok) {
    const errorBody = await sheetsResponse.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${sheetsResponse.status}: ${errorBody}`);
  }

  const sheetsData = await sheetsResponse.json() as { values?: unknown[][] };
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

      case 'reservations.list':
        return await listReservations(request, context.clientId, context.sheetId, debug);

      case 'capacity.list':
        return await listCapacity(request, context.clientId, context.sheetId, debug);

      // TODO: fullybooked.get
      // TODO: fullybooked.set
      // TODO: settings.get
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
