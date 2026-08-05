import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../migrations/20260802183000_atomic_reservation_sync_rpc.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../../rollbacks/20260802183000_atomic_reservation_sync_rpc_rollback.sql', import.meta.url),
  'utf8',
);

test('RPC migration defines idempotency, tenant locking and a 500-row boundary', () => {
  assert.match(migration, /add column request_id uuid/i);
  assert.match(migration, /unique \(client_id, request_id\)/i);
  assert.match(migration, /pg_try_advisory_xact_lock\(hashtextextended\(p_client_id/i);
  assert.match(migration, /jsonb_array_length\(p_rows\)/i);
  assert.match(migration, /v_row_count > 500/i);
  assert.match(migration, /jsonb_typeof\(p_rows\) <> 'array'/i);
  assert.match(migration, /DUPLICATE_LEGACY_RESERVATION_ID/);
});
test('RPC validates tenant-scoped references and protected ownership inside PostgreSQL', () => {
  assert.match(migration, /t\.client_id = p_client_id and t\.id = p\.table_id/i);
  assert.match(migration, /r\.client_id = p_client_id and r\.id = p\.resource_id/i);
  assert.match(migration, /r\.client_id = p_client_id\s+and r\.source_channel not in \('sheets', 'legacy_unknown'\)/i);
  assert.match(migration, /r\.client_id = p_client_id\s+and r\.legacy_reservation_id = p\.legacy_reservation_id/i);
  assert.match(migration, /for update of r/i);
});

test('RPC update list preserves immutable identity fields and never deletes', () => {
  const updateBlock = migration.match(/update public\.reservations r[\s\S]*?get diagnostics v_updated = row_count;/i)?.[0] ?? '';
  assert.ok(updateBlock);
  for (const immutable of ['id', 'client_id', 'legacy_reservation_id', 'public_reference', 'created_at', 'source_channel']) {
    assert.doesNotMatch(updateBlock, new RegExp(`(?:set|,)\\s*${immutable}\\s*=`, 'i'), immutable);
  }
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.match(migration, /'deleted', 0/i);
});

test('RPC uses a rollback subtransaction and stores only sanitized error codes', () => {
  assert.match(migration, /begin[\s\S]*exception\s+when others then/i);
  assert.match(migration, /error_summary = jsonb_build_array\(jsonb_build_object\('code', v_safe_error\)\)/i);
  assert.doesNotMatch(migration, /error_summary\s*=.*sqlerrm/i);
  assert.doesNotMatch(migration, /error_summary\s*=.*p_rows/i);
  assert.match(migration, /ATOMIC_SYNC_FAILED/);
});

test('RPC execution is service-role only and rollback stays manual', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
  assert.match(rollback, /drop function public\.apply_reservation_sync_plan/i);
  assert.doesNotMatch(rollback, /delete\s+from/i);
});
