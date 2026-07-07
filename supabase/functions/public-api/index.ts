import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://manager.costabots.com',
]);

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';

  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : '*',
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

function errorResponse(request: Request, code: string, message: string, status = 200, context: Record<string, unknown> = {}) {
  return jsonResponse(request, {
    ok: false,
    code,
    error: message,
    message,
    context,
  }, status);
}

function toStringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'si', 'sí', 'yes', 'activo', 'activa'].includes(toStringValue(value).toLowerCase());
}

function normalizeShow(show: Record<string, unknown>) {
  const nombre = toStringValue(show.nombre ?? show.name);
  const tipo = toStringValue(show.tipo ?? show.type) || 'single';
  const fecha = toStringValue(show.fecha ?? show.date);
  const dia = toStringValue(show.dia ?? show.weekday ?? show.day);
  const hora = toStringValue(show.hora ?? show.time);
  const activo = normalizeBoolean(show.activo ?? show.active);
  const visibleChatbot = normalizeBoolean(show.visible_chatbot ?? show.visibleInChatbot);
  const reservable = normalizeBoolean(show.reservable ?? show.bookable);

  return {
    id: toStringValue(show.id),
    nombre,
    name: nombre,
    tipo,
    type: tipo,
    fecha,
    date: fecha,
    dia,
    weekday: dia,
    hora,
    time: hora,
    activo,
    active: activo,
    visible_chatbot: visibleChatbot,
    visibleInChatbot: visibleChatbot,
    reservable,
    bookable: reservable,
    orden: Number(show.orden ?? show.order ?? 0) || 0,
  };
}

async function listShows(request: Request, dbClient: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const clientId = toStringValue(body.client_id ?? body.clientId);
  const publicToken = toStringValue(body.public_token ?? body.publicToken);

  if (!clientId || !publicToken) {
    return errorResponse(request, 'PUBLIC_AUTH_REQUIRED', 'client_id y public_token son obligatorios', 200, {
      hasClientId: Boolean(clientId),
      hasPublicToken: Boolean(publicToken),
    });
  }

  const { data: client, error: clientError } = await dbClient
    .from('CLIENTES')
    .select('client_id, rest_name, status, public_token')
    .eq('client_id', clientId)
    .eq('public_token', publicToken)
    .maybeSingle();

  if (clientError || !client) {
    return errorResponse(request, 'CLIENT_PUBLIC_AUTH_FAILED', 'Cliente o token publico no valido', 200, {
      client_id: clientId,
      supabase_error: clientError?.message,
    });
  }

  const clientStatus = toStringValue((client as Record<string, unknown>).status).toUpperCase() || 'ACTIVE';
  if (clientStatus === 'SUSPENDED' || clientStatus === 'EXPIRED') {
    return errorResponse(request, 'LICENSE_INACTIVE', 'Licencia inactiva', 200, {
      client_id: clientId,
      status: clientStatus,
    });
  }

  const { data, error } = await dbClient
    .from('SHOWS')
    .select('id, nombre, tipo, fecha, dia, hora, activo, visible_chatbot, reservable, orden')
    .eq('client_id', clientId)
    .eq('activo', true)
    .eq('visible_chatbot', true)
    .order('orden', { ascending: true })
    .order('hora', { ascending: true });

  if (error) {
    return errorResponse(request, 'SHOWS_LIST_FAILED', error.message, 200, {
      client_id: clientId,
      supabase_error: error.message,
    });
  }

  return jsonResponse(request, {
    ok: true,
    action: 'shows.list',
    client_id: clientId,
    shows: (data ?? []).map((show: Record<string, unknown>) => normalizeShow(show)),
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(request) });
  }

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = toStringValue(body.action || 'shows.list');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return errorResponse(request, 'SUPABASE_ENV_MISSING', 'Supabase env no configurado', 500, {
        hasUrl: Boolean(supabaseUrl),
        hasServiceRole: Boolean(supabaseServiceRoleKey),
      });
    }

    const dbClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    switch (action) {
      case 'shows.list':
        return await listShows(request, dbClient, body);

      default:
        return errorResponse(request, 'UNKNOWN_ACTION', `Accion no soportada: ${action}`, 200, { action });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(request, 'PUBLIC_API_ERROR', message, 500);
  }
});
