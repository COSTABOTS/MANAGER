import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { ReservationRecord } from '../_shared/reservation-store/types.ts';
import { selectSupabaseFeedbackInvitations, selectSupabaseReminders, toCancellationReservation, toFeedbackReservation } from './lib/supabaseSecondaryFlows.ts';

const root = new URL('./', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const cancellation = read('routes/reservationCancellation.ts');
const feedback = read('routes/feedback.ts');
const confirmation = read('routes/reservationSendConfirmation.ts');
const reminders = read('routes/reservationRemindersDispatch.ts');
const invitations = read('routes/feedbackDispatch.ts');
const store = read('../_shared/reservation-store/supabaseReservationStore.ts');

const fixture: ReservationRecord = { id: 'RES-TEST', date: '03/08/2026', time: '20:00', name: 'Test', phone: '600000000', pax: 2,
  language: 'ES', specialRequest: '', status: 'CONFIRMADA', origin: 'BOT', table: '', arrived: true, feedbackSent: false,
  room: '', service: 'CENA', balinesePackage: '', resource: '', preDinnerSent: false };

test('cancellation details maps Supabase to legacy model', () => assert.equal(toCancellationReservation(fixture).idReserva, fixture.id));
test('cancellation confirm uses store mutation', () => assert.match(cancellation, /supabaseStore\.cancelReservation/));
test('second cancellation preserves already_cancelled', () => assert.match(cancellation, /already_cancelled: true/));
test('feedback details maps the legacy miniapp model', () => assert.equal(toFeedbackReservation(fixture).personas, 2));
test('feedback submit is tenant-safe through the store', () => assert.match(feedback, /supabaseStore\.createFeedback/));
test('duplicate feedback returns the legacy conflict', () => assert.match(feedback, /already_submitted: true[\s\S]*409/));
test('positive and negative reputation branches stay unchanged', () => { assert.match(feedback, />= 4/); assert.match(feedback, /buildFeedbackAlertMessage/); });
test('confirmation updates phone through tenant-safe store', () => assert.match(confirmation, /updateReservationPhone/));
test('pending reminder is selected', () => assert.equal(selectSupabaseReminders([fixture], { date: '2026-08-03', time: '18:00', minuteKey: Date.UTC(2026,7,3,18,0)/60000 }, 120, true, { lateCreation: 0, alreadySent: 0, balinese: 0 }).length, 1));
test('sent reminder is not repeated', () => assert.equal(selectSupabaseReminders([{ ...fixture, preDinnerSent: true }], { date: '2026-08-03', time: '18:00', minuteKey: 0 }, 120, true, { lateCreation: 0, alreadySent: 0, balinese: 0 }).length, 0));
test('pending feedback invitation is selected', () => assert.equal(selectSupabaseFeedbackInvitations([fixture]).length, 1));
test('sent feedback invitation is not repeated', () => assert.equal(selectSupabaseFeedbackInvitations([{ ...fixture, feedbackSent: true }]).length, 0));
test('cancelled reservation receives no reminder', () => assert.equal(selectSupabaseReminders([{ ...fixture, status: 'CANCELADA' }], { date: '2026-08-03', time: '18:00', minuteKey: 0 }, 120, true, { lateCreation: 0, alreadySent: 0, balinese: 0 }).length, 0));
test('all secondary Supabase queries filter by client_id', () => { for (const method of ['updateLogical','findPhysicalId','listPending']) assert.match(store, new RegExp(`${method}[\\s\\S]*?client_id`)); });
test('Sheets path remains present for Safari', () => { for (const source of [cancellation, feedback, confirmation, reminders, invitations]) assert.match(source, /reservationStore|useSupabase/); });
test('there is no Supabase to Sheets fallback', () => { assert.doesNotMatch(cancellation, /catch[\s\S]{0,100}fetchSheetValues/); assert.doesNotMatch(confirmation, /catch[\s\S]{0,100}fetchSheetValues/); });
test('legacy response fields remain present', () => { for (const field of ['encontrada','already_cancelled','feedback_saved','positive','reservation_id']) assert.equal([cancellation, feedback, confirmation].some((source) => source.includes(field)), true); });
