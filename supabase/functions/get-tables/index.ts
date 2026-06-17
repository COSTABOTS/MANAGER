import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SheetRow = Record<string, string | number | boolean>;

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

function errorResponse(request: Request, code: string, message: string, status = 400) {
  return jsonResponse(request, { ok: false, code, error: message }, status);
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
  const parsedAccount = serviceAccountJson ? JSON.parse(serviceAccountJson) as { client_email?: string; private_key?: string } : null;
  const clientEmail = parsedAccount?.client_email ?? Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const privateKey = parsedAccount?.private_key ?? Deno.env.get('GOOGLE_PRIVATE_KEY');

  if (!clientEmail || !privateKey) {
    throw new Error('GOOGLE_SECRET_MISSING');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsignedJwt = `${base64UrlEncode(stringToBytes(JSON.stringify(header)))}.${base64UrlEncode(stringToBytes(JSON.stringify(claim)))}`;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(normalizePrivateKey(privateKey)),
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

function normalizeRows(values: unknown[][] | undefined): SheetRow[] {
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(request) });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = request.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '').trim();

    if (!supabaseUrl || !supabaseAnonKey) {
      return errorResponse(request, 'SUPABASE_ENV_MISSING', 'Supabase env no configurado', 500);
    }

    if (!jwt) {
      return errorResponse(request, 'UNAUTHENTICATED', 'No autenticado', 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(jwt);

    if (userError || !userData.user) {
      return errorResponse(request, 'UNAUTHENTICATED', 'JWT no valido', 401);
    }

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
      return errorResponse(request, 'PROFILE_NOT_FOUND', 'Profile activo no encontrado', 403);
    }

    const { data: client, error: clientError } = await dbClient
      .from('CLIENTES')
      .select('client_id, sheet_id, rest_name')
      .eq('client_id', String(profile.client_id).trim())
      .maybeSingle();

    if (clientError || !client) {
      return errorResponse(request, 'CLIENT_NOT_FOUND', 'Cliente no encontrado', 404);
    }

    if (!client.sheet_id) {
      return errorResponse(request, 'SHEET_ID_NOT_FOUND', 'Sheet ID no encontrado', 404);
    }

    const accessToken = await createGoogleAccessToken();
    const sheetsResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(client.sheet_id))}/values/${encodeURIComponent('MESAS!A:Z')}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!sheetsResponse.ok) {
      const errorBody = await sheetsResponse.text();
      throw new Error(`GOOGLE_SHEETS_ERROR: ${sheetsResponse.status}: ${errorBody}`);
    }

    const sheetsData = await sheetsResponse.json() as { values?: unknown[][] };
    const tables = normalizeRows(sheetsData.values);

    return jsonResponse(request, {
      ok: true,
      source: 'supabase_edge_google_sheets',
      client_id: client.client_id,
      tables,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    const code = message.startsWith('GOOGLE_SECRET_MISSING')
      ? 'GOOGLE_SECRET_MISSING'
      : message.startsWith('GOOGLE_AUTH_ERROR')
        ? 'GOOGLE_AUTH_ERROR'
        : message.startsWith('GOOGLE_SHEETS_ERROR')
          ? 'GOOGLE_SHEETS_ERROR'
          : 'UNKNOWN_ERROR';

    return errorResponse(request, code, message, 500);
  }
});
