import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { DbClient } from './lib/clients.ts';
import { validatePublicClient } from './lib/clients.ts';
import { createGoogleAccessToken, fetchSheetValues } from './lib/googleSheets.ts';
import {
  normalizeBoolean,
  normalizeDateKey,
  normalizeKey,
  normalizeService,
  normalizeTime,
  pickValue,
  rowsToObjects,
  toNumberValue,
  toStringValue,
} from './lib/normalization.ts';
import { errorResponse, getCorsHeaders, jsonResponse } from './lib/responses.ts';
import { handleAvailabilityByHour } from './routes/availabilityByHour.ts';
import { handleFeedback } from './routes/feedback.ts';
import { handleFeedbackDispatch } from './routes/feedbackDispatch.ts';
import { handleReservationCancellation } from './routes/reservationCancellation.ts';
import { handleReservationCreate } from './routes/reservationCreate.ts';
import { handleReservationSendConfirmation } from './routes/reservationSendConfirmation.ts';

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

function normalizeReservations(values: unknown[][] | undefined) {
  return rowsToObjects(values).flatMap((item) => {
    const idReserva = toStringValue(pickValue(item, ['ID_RESERVA', 'id_reserva', '0']));
    const fecha = normalizeDateKey(pickValue(item, ['FECHA', 'fecha', '1']));
    const hora = normalizeTime(pickValue(item, ['HORA', 'hora', '2']));
    const pax = toNumberValue(pickValue(item, ['PAX', 'pax', '5']));
    const estado = toStringValue(pickValue(item, ['ESTADO', 'estado', '8'])).toUpperCase();
    const servicio = normalizeService(pickValue(item, ['SERVICIO', 'servicio', 'service', '16']));

    if (!idReserva || !fecha) {
      return [];
    }

    return [{ idReserva, fecha, hora, pax, estado, servicio }];
  });
}

function normalizeCapacity(values: unknown[][] | undefined) {
  return rowsToObjects(values).flatMap((item) => {
    const hora = normalizeTime(pickValue(item, ['HORA', 'hora', 'TIME', 'time', '0']));
    if (!hora) {
      return [];
    }

    const limite = toNumberValue(pickValue(item, ['LIMITE', 'limite', 'CAPACIDAD', 'capacity', '1']));
    const activo = normalizeBoolean(pickValue(item, ['ACTIVO', 'activo', 'ACTIVE', 'active', '2']));

    return [{ hora, limite, activo }];
  });
}

function getControlHeaders(values: unknown[][] | undefined) {
  const headers = values?.[0]?.map((header) => toStringValue(header).toUpperCase()) ?? [];
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

function isFullyBookedForDate(values: unknown[][] | undefined, fecha: string) {
  if (!values?.length) {
    return false;
  }

  const headers = getControlHeaders(values);
  const targetDate = normalizeDateKey(fecha);

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    if (normalizeDateKey(row?.[headers.date]) === targetDate) {
      return normalizeBoolean(row?.[headers.fullyBooked]) || normalizeBoolean(row?.[headers.status]);
    }
  }

  return false;
}

async function listShows(request: Request, dbClient: DbClient, body: Record<string, unknown>) {
  const context = await validatePublicClient(request, dbClient, body);
  if ('error' in context) {
    return context.error;
  }

  const { data, error } = await dbClient
    .from('SHOWS')
    .select('id, nombre, tipo, fecha, dia, hora, activo, visible_chatbot, reservable, orden')
    .eq('client_id', context.clientId)
    .eq('activo', true)
    .eq('visible_chatbot', true)
    .order('orden', { ascending: true })
    .order('hora', { ascending: true });

  if (error) {
    console.error('[PUBLIC_API][SHOWS_LIST_FAILED]', { clientId: context.clientId, error: error.message });
    return errorResponse(request, 'SHOWS_LIST_FAILED', 200);
  }

  return jsonResponse(request, {
    ok: true,
    action: 'shows.list',
    client_id: context.clientId,
    shows: (data ?? []).map((show: Record<string, unknown>) => normalizeShow(show)),
  });
}

async function checkAvailability(request: Request, dbClient: DbClient, body: Record<string, unknown>) {
  const context = await validatePublicClient(request, dbClient, body);
  if ('error' in context) {
    return context.error;
  }

  const fecha = normalizeDateKey(body.fecha ?? body.date);
  const servicio = normalizeService(body.servicio ?? body.service);
  const hora = normalizeTime(body.hora ?? body.time);
  const pax = toNumberValue(body.pax);

  if (!fecha || !hora || pax <= 0) {
    return jsonResponse(request, {
      ok: true,
      available: false,
      remaining: 0,
      reason: 'invalid_request',
    });
  }

  if (!context.sheetId) {
    return errorResponse(request, 'INVALID_CLIENT', 404);
  }

  const accessToken = await createGoogleAccessToken();
  const [reservationsData, capacityData, controlData] = await Promise.all([
    fetchSheetValues(context.sheetId, 'RESERVAS!A:Z', accessToken),
    fetchSheetValues(context.sheetId, 'CAPACIDAD!A:C', accessToken),
    fetchSheetValues(context.sheetId, "'CONTROL RESERVAS'!A:D", accessToken),
  ]);

  if (isFullyBookedForDate(controlData.values, fecha)) {
    return jsonResponse(request, {
      ok: true,
      available: false,
      remaining: 0,
      reason: 'fully_booked',
    });
  }

  const reservations = normalizeReservations(reservationsData.values);
  const reservedPax = reservations
    .filter((reservation) =>
      reservation.fecha === fecha
      && reservation.hora === hora
      && reservation.servicio === servicio
      && reservation.estado !== 'CANCELADA')
    .reduce((total, reservation) => total + reservation.pax, 0);

  const capacityRows = normalizeCapacity(capacityData.values).filter((slot) => slot.activo);
  const slotCapacity = capacityRows.find((slot) => slot.hora === hora)?.limite ?? 0;
  const remaining = Math.max(0, slotCapacity - reservedPax);
  const available = slotCapacity > 0 && remaining >= pax;

  return jsonResponse(request, {
    ok: true,
    available,
    remaining,
    reason: available ? 'available' : 'capacity_exceeded',
  });
}

function createDbClient(request: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return {
      error: errorResponse(request, 'INTERNAL_ERROR', 500),
    };
  }

  return {
    dbClient: createClient(supabaseUrl, supabaseServiceRoleKey),
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(request) });
  }

  try {
    const url = new URL(request.url);
    const db = createDbClient(request);
    if ('error' in db) {
      return db.error;
    }

    const pathname = url.pathname.replace(/\/+$/, '');
    if (pathname.endsWith('/reservation/send-confirmation')) {
      return await handleReservationSendConfirmation(request, db.dbClient);
    }

    if (pathname.endsWith('/reservation/create')) {
      return await handleReservationCreate(request, db.dbClient);
    }

    if (pathname.endsWith('/reservation/cancellation/details')) {
      return await handleReservationCancellation(request, db.dbClient, 'details');
    }

    if (pathname.endsWith('/reservation/cancellation/confirm')) {
      return await handleReservationCancellation(request, db.dbClient, 'confirm');
    }

    if (pathname.endsWith('/availability/by-hour')) {
      return await handleAvailabilityByHour(request, db.dbClient);
    }

    if (pathname.endsWith('/feedback/details')) {
      return await handleFeedback(request, db.dbClient, 'details');
    }

    if (pathname.endsWith('/feedback/submit')) {
      return await handleFeedback(request, db.dbClient, 'submit');
    }

    if (pathname.endsWith('/feedback/send-pending')) {
      return await handleFeedbackDispatch(request, db.dbClient);
    }

    if (request.method !== 'POST') {
      return errorResponse(request, 'METHOD_NOT_ALLOWED', 405);
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = toStringValue(body.action || 'shows.list');

    switch (action) {
      case 'shows.list':
        return await listShows(request, db.dbClient, body);

      case 'availability.check':
        return await checkAvailability(request, db.dbClient, body);

      default:
        console.warn('[PUBLIC_API][UNKNOWN_ACTION]', { action: normalizeKey(action) });
        return errorResponse(request, 'UNKNOWN_ACTION', 200);
    }
  } catch (error) {
    console.error('[PUBLIC_API][INTERNAL_ERROR]', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(request, 'INTERNAL_ERROR', 500);
  }
});
