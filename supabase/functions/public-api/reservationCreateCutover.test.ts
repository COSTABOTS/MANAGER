import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./routes/reservationCreate.ts', import.meta.url), 'utf8');

test('public creation resolves the tenant store instead of forcing Sheets', () => {
  assert(source.includes('reservationStore: context.reservationStore'));
  assert(source.includes('}, dbClient)'));
  assert(source.includes('await store.createReservation(command)'));
  assert.equal(/reservationStore\s*:\s*['"]sheets['"]/.test(source), false);
});

test('Sheets append is only the SheetsReservationStore operation and there is no fallback', () => {
  const resolverCall = source.indexOf('const store = resolveReservationStore(');
  const sheetsOperation = source.indexOf('createReservation: async (reservation) => {', resolverCall);
  const append = source.indexOf("appendSheetValues(context.sheetId, 'RESERVAS!A:S'", sheetsOperation);
  const officialCreate = source.indexOf('await store.createReservation(command)', append);

  assert(resolverCall >= 0);
  assert(sheetsOperation > resolverCall);
  assert(append > sheetsOperation);
  assert(officialCreate > append);
  assert.equal(source.includes('fallback'), false);
});

test('Supabase tenants do not require sheet_id and legacy success is returned only after creation', () => {
  assert(source.includes("const usesSheets = (context.reservationStore ?? 'sheets').trim().toLowerCase() !== 'supabase'"));
  assert(source.includes('if (usesSheets && !context.sheetId)'));
  assert(source.indexOf('await store.createReservation(command)') < source.indexOf('reservation_created: true'));
  assert(source.includes('id_reserva: result.idReserva'));
});

test('missing reservation store defaults safely to Sheets', () => {
  assert(source.includes("(context.reservationStore ?? 'sheets').trim().toLowerCase()"));
  assert.equal(/context\.reservationStore\.trim\(\)/.test(source), false);
});
