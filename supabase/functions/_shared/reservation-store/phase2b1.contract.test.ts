import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildCreateReservationResult,
  normalizeCreateReservationInput,
} from '../../public-api/lib/reservations.ts';
import { resolveReservationStore } from './resolver.ts';
import type { CreateReservationCommand } from './types.ts';

const fixtureContext = {
  clientId: 'CB-FIXTURE-001',
  sheetId: 'sheet-fixture',
  reservationStore: 'sheets',
};

const fixedNow = new Date('2026-08-15T18:30:00.000Z');

const expectedPublicRow = [
  'RES-1786818600000-A1B2C3',
  '15/08/2026',
  '20:00',
  'Cliente Ejemplo',
  '34600000000',
  2,
  'ES',
  'Mesa tranquila',
  'CONFIRMADA',
  'BOT',
  '',
  'FALSE',
  'FALSE',
  '101',
  '2026-08-15T18:30:00.000Z',
  '2026-08-15T18:30:00.000Z',
  'CENA',
  '',
  '',
];

function makeCommand(overrides: Partial<CreateReservationCommand> = {}): CreateReservationCommand {
  return {
    id: 'RES-1786818600000-A1B2C3',
    date: '15/08/2026',
    time: '20:00',
    name: 'Cliente Ejemplo',
    phone: '+34600000000',
    pax: 2,
    language: 'ES',
    specialRequest: 'Mesa tranquila',
    status: 'CONFIRMADA',
    origin: 'BOT',
    table: '',
    arrived: false,
    feedbackSent: false,
    room: '101',
    service: 'CENA',
    balinesePackage: '',
    resource: '',
    ...overrides,
  };
}

test('public ES aliases preserve the 19 legacy Sheets columns and order', () => {
  const validation = normalizeCreateReservationInput({
    client_id: 'CB-FIXTURE-001',
    public_token: 'fixture-token',
    NOMBRE: 'Cliente Ejemplo',
    TELEFONO: '+34 600 000 000',
    FECHA: '2026-08-15',
    HORA: '20:00',
    PAX: '2',
    SERVICIO: 'cena',
    IDIOMA: 'es',
    ORIGEN: 'bot',
    HABITACION: '101',
    PETICION: 'Mesa tranquila',
  });

  assert.deepEqual(validation.missingFields, []);
  assert.deepEqual(validation.invalidFields, []);
  assert.ok(validation.normalized);

  const result = buildCreateReservationResult(validation.normalized, fixedNow);
  assert.match(result.idReserva, /^RES-\d{13}-[A-F0-9]{6}$/);
  assert.deepEqual(
    result.row.map((value, index) => index === 0 ? expectedPublicRow[0] : value),
    expectedPublicRow,
  );
  assert.equal(result.row.length, 19);
});

test('public EN aliases normalize to the same legacy contract', () => {
  const validation = normalizeCreateReservationInput({
    clientId: 'CB-FIXTURE-001',
    publicToken: 'fixture-token',
    nombre: 'Example Guest',
    telefono: '+34600000000',
    fecha: '15/08/2026',
    hora: '20:00:00',
    personas: 2,
    servicio: 'dinner',
    idioma: 'EN',
    origen: 'BOT',
    peticion_especial: 'No real data',
  });

  assert.deepEqual(validation.missingFields, []);
  assert.deepEqual(validation.invalidFields, []);
  assert.equal(validation.normalized?.idioma, 'EN');
  assert.equal(validation.normalized?.origen, 'BOT');
  assert.equal(validation.normalized?.peticion, 'No real data');
});

test('SheetsReservationStore mocks preserve all three write commands', async () => {
  const observed: Array<[string, CreateReservationCommand]> = [];
  const store = resolveReservationStore(fixtureContext, {
    createReservation: async (command) => {
      observed.push(['public', command]);
      return { reservation: command };
    },
    createManualReservation: async (command) => {
      observed.push(['manual', command]);
      return { reservation: command };
    },
    createWalkIn: async (command) => {
      observed.push(['walkin', command]);
      return { reservation: command };
    },
  });

  await store.createReservation(makeCommand());
  await store.createManualReservation(makeCommand({ origin: 'MANUAL' }));
  await store.createWalkIn(makeCommand({ origin: 'WALK-IN', arrived: true, phone: '' }));

  assert.deepEqual(observed, [
    ['public', makeCommand()],
    ['manual', makeCommand({ origin: 'MANUAL' })],
    ['walkin', makeCommand({ origin: 'WALK-IN', arrived: true, phone: '' })],
  ]);
});

test('adapted routes retain legacy responses, errors, range and omit reservation_store', () => {
  const publicSource = readFileSync(
    new URL('../../public-api/routes/reservationCreate.ts', import.meta.url),
    'utf8',
  );
  const managerSource = readFileSync(
    new URL('../../manager-api/index.ts', import.meta.url),
    'utf8',
  );

  for (const marker of [
    "reservation_created: true",
    "id_reserva: result.idReserva",
    "errorResponse(request, 'RESERVATION_CREATE_FAILED', 500)",
    "errorResponse(request, 'INVALID_REQUEST', 400",
    "'MAX_PAX_EXCEEDED'",
    "appendSheetValues(context.sheetId, 'RESERVAS!A:S', [result.row]",
  ]) {
    assert.ok(publicSource.includes(marker), `missing public legacy marker: ${marker}`);
  }

  for (const marker of [
    "action: 'reservation.create'",
    "action: 'walkin.create'",
    "'RESERVATION_REQUIRED_FIELDS'",
    "'WALKIN_REQUIRED_FIELDS'",
    "'RESERVAS!A:S'",
  ]) {
    assert.ok(managerSource.includes(marker), `missing Manager legacy marker: ${marker}`);
  }
  assert.match(managerSource, /client_id: clientId,\s+idReserva,\s+}\);/);

  const publicSuccess = publicSource.slice(publicSource.indexOf('return jsonResponse(request, {', publicSource.indexOf('await store.createReservation')));
  assert.ok(!publicSuccess.slice(0, publicSuccess.indexOf('}, 201);')).includes('reservation_store'));

  const manualSuccess = managerSource.slice(managerSource.indexOf('return jsonResponse(request, {', managerSource.indexOf('await store.createManualReservation')));
  assert.ok(!manualSuccess.slice(0, manualSuccess.indexOf('});')).includes('reservation_store'));

  const walkinSuccess = managerSource.slice(managerSource.indexOf('return jsonResponse(request, {', managerSource.indexOf('await store.createWalkIn')));
  assert.ok(!walkinSuccess.slice(0, walkinSuccess.indexOf('});')).includes('reservation_store'));
});
