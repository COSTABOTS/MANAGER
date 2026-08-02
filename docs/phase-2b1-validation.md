# Phase 2B.1 validation

## Scope

Phase 2B.1 introduces the `ReservationStore` abstraction while keeping every tenant on Google Sheets. It does not enable `SupabaseReservationStore`, migrate data, or change public HTTP contracts.

## Validation status

- Contract validation: complete.
- Public API read smoke test for `availability/by-hour`: passed for the operational Demo tenant and Safari.
- Contract tests for public reservation creation, manual reservation creation and walk-in creation: passed without real writes.
- Manager API `reservations.list`: statically validated against the legacy aliases, fields and Sheets range.
- Real Manager API `reservations.list` validation: pending until this commit is deployed.

The post-deployment smoke test must be read-only. It must check only:

1. `reservations.list` for Demo and Safari.
2. `availability/by-hour` for Demo and Safari.
3. Manager can load the reservations view.
4. Demo and Safari still resolve `reservation_store = 'sheets'`.
5. The nine Hospitality operational tables remain empty.
6. HTTP status, JSON field names, types, aliases and legacy values remain unchanged.

Do not create, update, cancel or otherwise mutate reservations during the smoke test.

## Automated checks

Run from the repository root:

```powershell
node --experimental-strip-types --test supabase/functions/_shared/reservation-store/*.test.ts
npx.cmd deno check supabase/functions/_shared/reservation-store/resolver.ts supabase/functions/_shared/reservation-store/sheetsReservationStore.ts
git diff --check HEAD^ HEAD
```

Expected contract-test result: 9 passed, 0 failed.

## Deployment gate

Do not start Phase 2B.2 until both affected Edge Functions are deployed and the read-only post-deployment smoke test has passed.
