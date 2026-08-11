import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./routes/reservationSendConfirmation.ts', import.meta.url), 'utf8');

test('confirmation selects Supabase by tenant and preserves Sheets branch', () => {
  assert(source.includes("const useSupabase = (context.reservationStore ?? 'sheets').toString().trim().toLowerCase() === 'supabase'"));
  assert(source.includes('store.listReservations()'));
  assert(source.includes('store.updateReservationPhone'));
  assert(source.includes("fetchSheetValues(context.sheetId, 'RESERVAS!A:Z'"));
  assert(source.includes('updateSheetCell(context.sheetId'));
});

test('confirmation has no Supabase-to-Sheets fallback or new PII logging', () => {
  assert.equal(/catch[\s\S]{0,180}fetchSheetValues/.test(source), false);
  assert.equal(source.includes('console.log(phone'), false);
  assert.equal(source.includes('console.log(message'), false);
  assert(source.includes('WHATSAPP_SEND_FAILED'));
});
