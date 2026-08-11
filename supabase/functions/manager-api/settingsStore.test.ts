import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

test('Manager settings selects the store from the resolved client context', () => {
  assert(source.includes("pickRecordValue(resolvedClient, ['reservation_store', 'reservationStore'])"));
  assert(source.includes('reservationStore: resolvedReservationStore'));
  assert(source.includes("case 'settings.get':"));
  assert(source.includes("case 'settings.save':"));
});

test('Supabase settings use CLIENTE_ID and Sheets remains the legacy branch', () => {
  assert(source.includes(".from('SETTINGS').select('CLAVE,VALOR')"));
  assert(source.includes(".eq('CLIENTE_ID', clientId)"));
  assert(source.includes(".from('SETTINGS').update({ VALOR: value })"));
  assert(source.includes("fetchSheetValues(sheetId, 'SETTINGS!A:Z'"));
  assert(source.includes("values/${encodeURIComponent('SETTINGS!A1:Z')}"));
});
