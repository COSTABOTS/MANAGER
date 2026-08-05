import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeAdministrativeToken,
  authorizeAdministrativeRequest,
  reservationSyncRequestId,
  syncReservations,
  type AtomicReservationPlanRow,
  type AtomicReservationSyncResult,
  type ReservationSyncAdapter,
  type ReservationSyncRow,
} from './syncReservations.ts';

const HEADERS = [
  'ID_RESERVA', 'FECHA', 'HORA', 'NOMBRE', 'TELEFONO', 'PAX', 'IDIOMA',
  'PETICION_ESPECIAL', 'ESTADO', 'ORIGEN', 'MESA', 'LLEGO', 'FEEDBACK_ENVIADO',
  'HABITACION', 'CREATED_AT', 'UPDATED_AT', 'SERVICIO', 'PAQUETE BALINESA',
  'RECURSO', 'PRECENA_ENVIADO',
];

function sheetRow(id: string, overrides: Record<number, unknown> = {}) {
  const row: unknown[] = [
    id, '16/08/2026', '20:00', 'Persona Sintética', '+34000000000', '2', 'ES',
    'Petición sintética', 'CONFIRMADA', 'BOT', 'S1', 'TRUE', 'FALSE', 'H-TEST',
    'legacy-created', 'legacy-updated', 'CENA', '', 'R1', 'TRUE',
  ];
  Object.entries(overrides).forEach(([index, value]) => row[Number(index)] = value);
  return row;
}

class FakeAdapter implements ReservationSyncAdapter {
  readonly rows = new Map<string, ReservationSyncRow>();
  readonly activeRuns = new Set<string>();
  readonly completedRequests = new Map<string, AtomicReservationSyncResult>();
  readonly calls = { apply: 0, delete: 0 };
  tables = new Map([['S1', 'table-demo']]);
  resources = new Map([['R1', 'resource-demo']]);

  key(clientId: string, legacyId: string) { return `${clientId}|${legacyId}`; }
  async listExisting(clientId: string, ids: string[]) {
    return ids.flatMap((id) => {
      const row = this.rows.get(this.key(clientId, id));
      return row ? [structuredClone(row)] : [];
    });
  }
  async resolveTableIds(_clientId: string, labels: string[]) {
    return new Map(labels.flatMap((label) => this.tables.has(label) ? [[label, this.tables.get(label)!]] : []));
  }
  async resolveResourceIds(_clientId: string, labels: string[]) {
    return new Map(labels.flatMap((label) => this.resources.has(label) ? [[label, this.resources.get(label)!]] : []));
  }
  async applyAtomicPlan(clientId: string, requestId: string, plan: AtomicReservationPlanRow[]) {
    this.calls.apply += 1;
    const requestKey = `${clientId}|${requestId}`;
    const completed = this.completedRequests.get(requestKey);
    if (completed) return {
      ...structuredClone(completed), inserted: 0, updated: 0,
      skipped: completed.inserted + completed.updated + completed.skipped,
      idempotent_replay: true,
    };
    if (this.activeRuns.has(clientId)) throw new Error('SYNC_ALREADY_RUNNING');
    this.activeRuns.add(clientId);
    const snapshot = structuredClone(this.rows);
    try {
      for (const row of plan) {
        const current = this.rows.get(this.key(clientId, row.legacy_reservation_id));
        if (current && !['sheets', 'legacy_unknown'].includes(current.source_channel)) {
          throw new Error('PROTECTED_SOURCE_CONFLICT');
        }
      }
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      for (const row of plan) {
        if (row.legacy_reservation_id === 'FAIL-LAST') throw new Error('ATOMIC_INSERT_FAILED');
        const key = this.key(clientId, row.legacy_reservation_id);
        const current = this.rows.get(key);
        if (!current) {
          inserted += 1;
          this.rows.set(key, {
            ...structuredClone(row), id: `uuid-${this.rows.size + 1}`, client_id: clientId,
            public_reference: row.legacy_reservation_id, source_channel: 'sheets', created_at: 'created-on-insert',
          });
          continue;
        }
        const desired = { ...current, ...structuredClone(row) };
        if (JSON.stringify(current) === JSON.stringify(desired)) skipped += 1;
        else {
          updated += 1;
          this.rows.set(key, desired);
        }
      }
      const result: AtomicReservationSyncResult = {
        run_id: `run-${requestId}`, status: 'completed', inserted, updated, skipped,
        deleted: 0, errors: 0, idempotent_replay: false,
      };
      this.completedRequests.set(requestKey, structuredClone(result));
      return result;
    } catch (error) {
      this.rows.clear();
      snapshot.forEach((value, key) => this.rows.set(key, value));
      throw error;
    } finally {
      this.activeRuns.delete(clientId);
    }
  }
}

test('dry_run calculates a plan in memory and performs exactly zero writes', async () => {
  const adapter = new FakeAdapter();
  const result = await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('RES-1')], dryRun: true, adapter });
  assert.deepEqual({ run: result.run_id, inserts: result.inserts, updates: result.updates, deletes: result.deletes, skips: result.skips },
    { run: null, inserts: 0, updates: 0, deletes: 0, skips: 0 });
  assert.deepEqual({ wouldInsert: result.would_insert, wouldUpdate: result.would_update, wouldSkip: result.would_skip },
    { wouldInsert: 1, wouldUpdate: 0, wouldSkip: 0 });
  assert.deepEqual(adapter.calls, { apply: 0, delete: 0 });
  assert.equal(adapter.rows.size, 0);
});

test('real run inserts, second identical run skips, and never deletes', async () => {
  const adapter = new FakeAdapter();
  const values = [HEADERS, sheetRow('RES-1')];
  const first = await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: values, dryRun: false, adapter });
  const second = await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: values, dryRun: false, adapter });
  assert.deepEqual([first.inserts, first.updates, first.skips], [1, 0, 0]);
  assert.deepEqual([second.inserts, second.updates, second.skips], [0, 0, 1]);
  assert.equal(first.idempotent_replay, false);
  assert.equal(second.idempotent_replay, true);
  assert.equal(adapter.calls.delete, 0);
  assert.equal(first.deletes, 0);
  assert.equal(second.deletes, 0);
});

test('update changes only synchronizable fields and preserves immutable identity', async () => {
  const adapter = new FakeAdapter();
  await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('RES-1')], dryRun: false, adapter });
  const key = adapter.key('CB-DEMO-002', 'RES-1');
  const before = structuredClone(adapter.rows.get(key)!);
  const result = await syncReservations({
    clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('RES-1', { 5: '4' })], dryRun: false, adapter,
  });
  const after = adapter.rows.get(key)!;
  assert.equal(result.updates, 1);
  assert.equal(after.pax, 4);
  assert.equal(after.id, before.id);
  assert.equal(after.public_reference, before.public_reference);
  assert.equal(after.created_at, before.created_at);
  assert.equal(after.source_channel, before.source_channel);
});

test('atomic plan can mix insert, update and skip', async () => {
  const adapter = new FakeAdapter();
  await syncReservations({
    clientId: 'CB-DEMO-002',
    sheetValues: [HEADERS, sheetRow('SAME'), sheetRow('CHANGE')],
    dryRun: false,
    adapter,
  });
  const result = await syncReservations({
    clientId: 'CB-DEMO-002',
    sheetValues: [HEADERS, sheetRow('SAME'), sheetRow('CHANGE', { 5: '4' }), sheetRow('NEW')],
    dryRun: false,
    adapter,
  });
  assert.deepEqual([result.inserts, result.updates, result.skips], [1, 1, 1]);
  assert.equal(adapter.rows.size, 3);
});

test('all identity operations are isolated by client_id and legacy_reservation_id', async () => {
  const adapter = new FakeAdapter();
  await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('SHARED-ID')], dryRun: false, adapter });
  await syncReservations({ clientId: 'CB-OTHER-001', sheetValues: [HEADERS, sheetRow('SHARED-ID', { 5: '6' })], dryRun: false, adapter });
  assert.equal(adapter.rows.size, 2);
  assert.equal(adapter.rows.get(adapter.key('CB-DEMO-002', 'SHARED-ID'))?.pax, 2);
  assert.equal(adapter.rows.get(adapter.key('CB-OTHER-001', 'SHARED-ID'))?.pax, 6);
});

test('duplicate Sheet IDs are rejected without inserts', async () => {
  const adapter = new FakeAdapter();
  const result = await syncReservations({
    clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('DUP'), sheetRow('DUP')], dryRun: true, adapter,
  });
  assert.equal(result.would_insert, 0);
  assert.equal(result.blocking_errors, 2);
  assert.equal(result.rows_blocked, 2);
  assert.equal(result.error_summary[0]?.code, 'DUPLICATE_LEGACY_RESERVATION_ID');
});

test('more than 500 source rows are rejected before reads or writes', async () => {
  const adapter = new FakeAdapter();
  const rows = Array.from({ length: 501 }, (_, index) => sheetRow(`LIMIT-${index}`));
  await assert.rejects(
    () => syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, ...rows], dryRun: false, adapter }),
    /SYNC_ROW_LIMIT_EXCEEDED/,
  );
  assert.equal(adapter.calls.apply, 0);
  assert.equal(adapter.rows.size, 0);
});

test('every non-legacy source channel is protected when legacy ID matches', async () => {
  const adapter = new FakeAdapter();
  const protectedSources = ['demo', 'typebot', 'widget', 'whatsapp_ai', 'manager_manual', 'walk_in', 'phone', 'api_partner'];
  const rows = protectedSources.map((source, index) => {
    const id = `RES-PROTECTED-${index}`;
    adapter.rows.set(adapter.key('CB-DEMO-002', id), {
      client_id: 'CB-DEMO-002', legacy_reservation_id: id, source_channel: source,
      public_reference: 'KEEP', booking_date: '2026-08-16', booking_time: '20:00', service: 'CENA',
      customer_name: null, customer_phone: null, pax: 9, locale: 'es', special_request: null,
      status: 'confirmed', legacy_status: 'CONFIRMADA', legacy_source: 'DEMO', table_id: null,
      resource_id: null, room: null, arrived: false, feedback_sent: false, pre_dinner_sent: false,
      balinese_package: null, legacy_created_at: null, legacy_updated_at: null, legacy_locale: 'ES',
    });
    return sheetRow(id);
  });
  const result = await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, ...rows], dryRun: false, adapter });
  assert.equal(result.updates, 0);
  assert.equal(result.blocking_errors, protectedSources.length);
  protectedSources.forEach((_source, index) => {
    assert.equal(adapter.rows.get(adapter.key('CB-DEMO-002', `RES-PROTECTED-${index}`))?.pax, 9);
  });
  assert.ok(result.error_summary.every((item) => item.code === 'PROTECTED_SOURCE_CHANNEL'));
});

test('missing table/resource produce null tenant-safe references and sanitized issues', async () => {
  const adapter = new FakeAdapter();
  adapter.tables.clear();
  adapter.resources.clear();
  const result = await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('RES-MISSING')], dryRun: false, adapter });
  const inserted = adapter.rows.get(adapter.key('CB-DEMO-002', 'RES-MISSING'))!;
  assert.equal(inserted.table_id, null);
  assert.equal(inserted.resource_id, null);
  assert.deepEqual(result.error_summary.map((item) => item.field), ['table_id', 'resource_id']);
  assert.equal(result.warnings, 2);
  assert.equal(result.blocking_errors, 0);
  assert.equal(result.inserts, 1);
  const serialized = JSON.stringify(result.error_summary);
  for (const forbidden of ['Persona Sintética', '+34000000000', 'H-TEST', 'Petición sintética', 'S1', 'R1']) {
    assert.ok(!serialized.includes(forbidden));
  }
});

test('86 missing IDs, invalid date and invalid pax are excluded with exact counters', async () => {
  const adapter = new FakeAdapter();
  const missing = Array.from({ length: 86 }, () => sheetRow('', {}));
  const values = [HEADERS, ...missing, sheetRow('BAD-DATE', { 1: 'not-a-date' }), sheetRow('BAD-PAX', { 5: '0' }), sheetRow('VALID')];
  const result = await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: values, dryRun: true, adapter });
  assert.equal(result.rows_read, 89);
  assert.equal(result.rows_excluded, 88);
  assert.equal(result.rows_importable, 1);
  assert.equal(result.rows_blocked, 0);
  assert.equal(result.blocking_errors, 0);
  assert.equal(result.would_insert, 1);
  assert.deepEqual(result.excluded_by_code, {
    MISSING_LEGACY_RESERVATION_ID: 86,
    INVALID_BOOKING_DATE: 1,
    INVALID_PAX: 1,
  });
});

test('unresolved table warning does not block a real insert', async () => {
  const adapter = new FakeAdapter();
  adapter.tables.clear();
  const result = await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('WARN', { 18: '' })], dryRun: false, adapter });
  assert.equal(result.inserts, 1);
  assert.equal(result.warnings, 1);
  assert.equal(result.blocking_errors, 0);
  assert.equal(result.rows_with_warnings, 1);
});

test('real run processes only importable rows when there are exclusions and no blockers', async () => {
  const adapter = new FakeAdapter();
  const result = await syncReservations({
    clientId: 'CB-DEMO-002',
    sheetValues: [HEADERS, sheetRow(''), sheetRow('VALID-REAL')],
    dryRun: false,
    adapter,
  });
  assert.equal(result.rows_excluded, 1);
  assert.equal(result.rows_importable, 1);
  assert.equal(result.blocking_errors, 0);
  assert.equal(result.inserts, 1);
  assert.equal(adapter.rows.size, 1);
  assert.equal(adapter.calls.delete, 0);
});

test('protected ownership blocks the entire real plan before writes', async () => {
  const adapter = new FakeAdapter();
  adapter.rows.set(adapter.key('CB-DEMO-002', 'PROTECTED'), {
    client_id: 'CB-DEMO-002', legacy_reservation_id: 'PROTECTED', source_channel: 'demo',
    booking_date: '2026-08-16', booking_time: '20:00', service: 'CENA', customer_name: null,
    customer_phone: null, pax: 2, locale: 'es', special_request: null, status: 'confirmed',
    legacy_status: 'CONFIRMADA', legacy_source: 'DEMO', table_id: null, resource_id: null,
    room: null, arrived: false, feedback_sent: false, pre_dinner_sent: false,
    balinese_package: null, legacy_created_at: null, legacy_updated_at: null, legacy_locale: 'ES',
  });
  const result = await syncReservations({
    clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('IMPORTABLE'), sheetRow('PROTECTED')], dryRun: false, adapter,
  });
  assert.equal(result.blocking_errors, 1);
  assert.equal(result.inserts, 0);
  assert.equal(adapter.rows.has(adapter.key('CB-DEMO-002', 'IMPORTABLE')), false);
});

test('administrative HTTP policy accepts service role and active SUPER_ADMIN only', async () => {
  const service = await authorizeAdministrativeToken('service-token', {
    serviceRoleCanReadRuns: async () => true,
    getAuthenticatedUserId: async () => { throw new Error('must not run'); },
    isActiveSuperAdmin: async () => false,
  });
  assert.equal(service, 'service_role');
  const admin = await authorizeAdministrativeToken('admin-jwt', {
    serviceRoleCanReadRuns: async () => false,
    getAuthenticatedUserId: async () => 'user-id',
    isActiveSuperAdmin: async () => true,
  });
  assert.equal(admin, 'super_admin');
  await assert.rejects(() => authorizeAdministrativeToken('user-jwt', {
    serviceRoleCanReadRuns: async () => false,
    getAuthenticatedUserId: async () => 'user-id',
    isActiveSuperAdmin: async () => false,
  }), /ADMIN_REQUIRED/);
  await assert.rejects(() => authorizeAdministrativeToken('', {
    serviceRoleCanReadRuns: async () => false,
    getAuthenticatedUserId: async () => null,
    isActiveSuperAdmin: async () => false,
  }), /UNAUTHENTICATED/);
});

test('authentication failures and source do not expose supplied credentials', async () => {
  const secret = 'service-role-secret-marker';
  let message = '';
  try {
    await authorizeAdministrativeToken(secret, {
      serviceRoleCanReadRuns: async () => false,
      getAuthenticatedUserId: async () => null,
      isActiveSuperAdmin: async () => false,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.ok(!message.includes(secret));
});

test('HTTP authentication returns sanitized 401/403 responses and no response for authorized callers', async () => {
  const adapter = {
    serviceRoleCanReadRuns: async (token: string) => token === 'service-token',
    getAuthenticatedUserId: async (token: string) => token === 'admin-token' || token === 'user-token' ? 'user-id' : null,
    isActiveSuperAdmin: async () => true,
  };
  assert.equal(await authorizeAdministrativeRequest(new Request('https://local.test', { headers: { Authorization: 'Bearer service-token' } }), adapter), null);
  assert.equal(await authorizeAdministrativeRequest(new Request('https://local.test', { headers: { Authorization: 'Bearer admin-token' } }), adapter), null);
  const missing = await authorizeAdministrativeRequest(new Request('https://local.test'), adapter);
  assert.equal(missing?.status, 401);
  assert.deepEqual(await missing?.json(), { error: 'UNAUTHENTICATED' });
  const rejected = await authorizeAdministrativeRequest(new Request('https://local.test', { headers: { Authorization: 'Bearer rejected-secret' } }), {
    ...adapter,
    getAuthenticatedUserId: async () => 'user-id',
    isActiveSuperAdmin: async () => false,
  });
  assert.equal(rejected?.status, 403);
  assert.deepEqual(await rejected?.json(), { error: 'ADMIN_REQUIRED' });
  assert.ok(!JSON.stringify(await authorizeAdministrativeRequest(new Request('https://local.test', { headers: { Authorization: 'Bearer invalid-secret' } }), adapter)).includes('invalid-secret'));
});

test('a second real run is blocked while another run is active', async () => {
  const adapter = new FakeAdapter();
  adapter.activeRuns.add('CB-DEMO-002');
  const result = await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('BLOCKED')], dryRun: false, adapter });
  assert.equal(result.status, 'failed');
  assert.equal(result.blocking_errors, 1);
  assert.equal(adapter.rows.size, 0);
});

test('atomic adapter applies 30 inserts in one call', async () => {
  const adapter = new FakeAdapter();
  const rows = Array.from({ length: 30 }, (_, index) => sheetRow(`ATOMIC-${index + 1}`));
  const result = await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, ...rows], dryRun: false, adapter });
  assert.equal(result.inserts, 30);
  assert.equal(result.updates, 0);
  assert.equal(result.skips, 0);
  assert.equal(adapter.calls.apply, 1);
  assert.equal(adapter.rows.size, 30);
});

test('failure on the last atomic row rolls back the full batch', async () => {
  const adapter = new FakeAdapter();
  const result = await syncReservations({
    clientId: 'CB-DEMO-002',
    sheetValues: [HEADERS, sheetRow('FIRST'), sheetRow('FAIL-LAST')],
    dryRun: false,
    adapter,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.inserts, 0);
  assert.equal(adapter.rows.size, 0);
});

test('request id is stable for the same tenant and plan and differs across tenants', async () => {
  const row: AtomicReservationPlanRow = {
    legacy_reservation_id: 'STABLE', booking_date: '2026-08-16', booking_time: '20:00',
    service: 'CENA', customer_name: null, customer_phone: null, pax: 2, locale: 'es',
    special_request: null, status: 'confirmed', legacy_status: 'CONFIRMADA', legacy_source: 'BOT',
    table_id: null, resource_id: null, room: null, arrived: false, feedback_sent: false,
    pre_dinner_sent: false, balinese_package: null, legacy_created_at: null,
    legacy_updated_at: null, legacy_locale: 'ES',
  };
  const first = await reservationSyncRequestId('CB-DEMO-002', [row]);
  assert.equal(first, await reservationSyncRequestId('CB-DEMO-002', [row]));
  assert.notEqual(first, await reservationSyncRequestId('CB-OTHER-001', [row]));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('an active run for one tenant does not block a different tenant', async () => {
  const adapter = new FakeAdapter();
  adapter.activeRuns.add('CB-DEMO-002');
  const result = await syncReservations({ clientId: 'CB-OTHER-001', sheetValues: [HEADERS, sheetRow('OTHER')], dryRun: false, adapter });
  assert.equal(result.inserts, 1);
  assert.equal(adapter.rows.size, 1);
});

test('normalizes legacy status/source and all approved destination columns', async () => {
  const adapter = new FakeAdapter();
  await syncReservations({ clientId: 'CB-DEMO-002', sheetValues: [HEADERS, sheetRow('RES-MAP')], dryRun: false, adapter });
  const row = adapter.rows.get(adapter.key('CB-DEMO-002', 'RES-MAP'))!;
  assert.equal(row.status, 'confirmed');
  assert.equal(row.legacy_status, 'CONFIRMADA');
  assert.equal(row.source_channel, 'sheets');
  assert.equal(row.legacy_source, 'BOT');
  assert.equal(row.legacy_created_at, 'legacy-created');
  assert.equal(row.legacy_updated_at, 'legacy-updated');
  assert.equal(row.pre_dinner_sent, true);
  assert.equal(row.room, 'H-TEST');
  assert.equal(row.legacy_locale, 'ES');
});
