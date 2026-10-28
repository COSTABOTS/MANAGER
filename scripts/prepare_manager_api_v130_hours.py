"""Build isolated, deterministic Manager API candidate and v130 recovery ZIPs.

Only Git objects are deployment sources. The hashes below came from the active
v130 download after CRLF normalization; the download is verification evidence.
Nothing in this script contacts Supabase or edits a worktree.
"""

from __future__ import annotations

import hashlib
import json
import posixpath
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
V130_GIT_BASE = "ad2c21845f39ef3dcde6162c4d110d6995c84c30"
HOURS_COMMIT = "83499d15cbb330936b4be7a520e8b80412936158"
RUNTIME_SHA256 = {
    "manager-api/index.ts": "59C2ED7C3EEDD02F75863024443D5CDB23996F410D2E1A911644B074895C3C16",
    "manager-api/reservationListSource.ts": "D84763EFDEAC8746F1DC9272ADE0A8E98E1A7703D48B0291AA5074DDBCCD1439",
    "_shared/reservation-store/errors.ts": "9A6AF6D7D296C0FFD0E6BB83648B68BCFFFDE6658BF240A31552A535D3B33452",
    "_shared/reservation-store/resolver.ts": "8796BCA794C7D8DF3CF02D5BF3400797ACA14F46067A94FBD243BF165945AB19",
    "_shared/reservation-store/sheetsReservationStore.ts": "78BF69653EAED3BCF64B3E1CE4630709B95B46FFD8D1C13E6EE488E408E2F109",
    "_shared/reservation-store/supabaseReservationStore.ts": "FB4D75A3A3A59D4F0D1DF01A74C57B4507553E3E8D9B6385811E1E21DAB6FFE2",
}
EXTRA_BASE = ["_shared/reservation-store/types.ts"]  # Type-only import, absent from the downloaded runtime.
NEW_MANAGER_MODULES = [
    "manager-api/cors.ts",
    "manager-api/hoursWriteGate.ts",
    "manager-api/poolHoursActions.ts",
    "manager-api/poolHoursHttp.ts",
    "manager-api/weeklyHoursActions.ts",
    "manager-api/weeklyHoursHttp.ts",
]
LEGACY_TEST_APPENDIX = """

test('manager package legacy Sunday uses weekday 7, not weekday 0, without SETTINGS reads', async () => {
  const client = new FixtureClient({
    booking_capacity_slots: [
      { client_id: context.clientId, slot_time: '18:00:00', capacity: 4, active: true, service: 'CENA', weekday: 7, valid_from: null, valid_until: null },
      { client_id: context.clientId, slot_time: '19:00:00', capacity: 4, active: true, service: 'CENA', weekday: 0, valid_from: null, valid_until: null },
      { client_id: context.clientId, slot_time: '20:00:00', capacity: 4, active: true, service: 'CENA', weekday: null, valid_from: null, valid_until: null },
    ],
    SETTINGS: [{ CLIENTE_ID: context.clientId, CLAVE: 'WEEKLY_HOURS_ENABLED', VALOR: 'false' }],
  });
  const result = await new SupabaseReservationStore(context, client).getAvailability({ date: '2026-08-16', requestedPax: 1, service: 'CENA' });
  assert.deepEqual(result.availableTimes, ['18:00', '20:00']);
  assert.equal(client.calls.includes('SETTINGS'), false);
});

test('manager package legacy Monday uses weekday 1 and general capacity with absent weekly flag', async () => {
  const client = new FixtureClient({
    booking_capacity_slots: [
      { client_id: context.clientId, slot_time: '17:00:00', capacity: 4, active: true, service: 'CENA', weekday: 1, valid_from: null, valid_until: null },
      { client_id: context.clientId, slot_time: '18:00:00', capacity: 4, active: true, service: 'CENA', weekday: 7, valid_from: null, valid_until: null },
      { client_id: context.clientId, slot_time: '20:00:00', capacity: 4, active: true, service: 'CENA', weekday: null, valid_from: null, valid_until: null },
    ],
  });
  const result = await new SupabaseReservationStore(context, client).getAvailability({ date: '2026-08-17', requestedPax: 1, service: 'CENA' });
  assert.deepEqual(result.availableTimes, ['17:00', '20:00']);
  assert.equal(client.calls.includes('SETTINGS'), false);
});
"""


def git_file(revision: str, relative: str) -> bytes:
    return subprocess.check_output(
        ["git", "show", f"{revision}:supabase/functions/{relative}"], cwd=ROOT
    )


def normalized(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def write_sources(directory: Path, files: dict[str, bytes]) -> None:
    for relative, data in files.items():
        target = directory / "supabase" / "functions" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def write_zip(target: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(target, "w") as archive:
        for relative, data in sorted(files.items()):
            item = zipfile.ZipInfo(f"supabase/functions/{relative}", (1980, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.create_system = 3
            item.external_attr = 0o644 << 16
            archive.writestr(item, data)


def check_imports(files: dict[str, bytes]) -> None:
    for relative, data in files.items():
        text = data.decode("utf-8")
        for target in re.findall(r"\bfrom\s+['\"]([^'\"]+)['\"]", text):
            if not target.startswith("."):
                continue
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(relative), target))
            if resolved not in files:
                raise RuntimeError(f"Missing import {relative} -> {target}")


def main() -> None:
    baseline = {relative: normalized(git_file(V130_GIT_BASE, relative)) for relative in [*RUNTIME_SHA256, *EXTRA_BASE]}
    old_cors = b"  'https://manager.costabots.com',\n"
    new_cors = old_cors + (
        b"  'https://manager-4u8ir2cd5-costabots-projects.vercel.app',\n"
        b"  'https://manager-preview.costabots.com',\n"
    )
    if baseline["manager-api/index.ts"].count(old_cors) != 1:
        raise RuntimeError("v130 CORS insertion point is not unique")
    baseline["manager-api/index.ts"] = baseline["manager-api/index.ts"].replace(old_cors, new_cors)
    for relative, expected in RUNTIME_SHA256.items():
        if sha256(baseline[relative]) != expected:
            raise RuntimeError(f"Git reconstruction does not match downloaded v130: {relative}")

    candidate = dict(baseline)
    candidate["manager-api/index.ts"] = normalized(git_file(HOURS_COMMIT, "manager-api/index.ts"))
    for relative in NEW_MANAGER_MODULES:
        candidate[relative] = normalized(git_file(HOURS_COMMIT, relative))
    if candidate["_shared/reservation-store/supabaseReservationStore.ts"] != baseline["_shared/reservation-store/supabaseReservationStore.ts"]:
        raise RuntimeError("Candidate changed the v130 reservation store")
    store = candidate["_shared/reservation-store/supabaseReservationStore.ts"]
    if b"getIsoWeekday" not in store or b"day === 0 ? 7 : day" not in store or b"booking-hours" in store:
        raise RuntimeError("Legacy weekday/availability implementation changed")
    old_actions = set(re.findall(rb"case '([^']+)'", baseline["manager-api/index.ts"]))
    new_actions = set(re.findall(rb"case '([^']+)'", candidate["manager-api/index.ts"]))
    expected_new = {b"weeklyHours.get", b"weeklyHours.save", b"poolHours.get", b"poolHours.save"}
    if not old_actions.issubset(new_actions) or new_actions - old_actions != expected_new:
        raise RuntimeError("Existing v130 action surface changed")
    if b"REMOTE_HOURS_PREVIEW_ENABLED" in candidate["manager-api/index.ts"]:
        raise RuntimeError("Browser preview gate must not authorize server writes")
    check_imports(baseline)
    check_imports(candidate)

    output = Path(tempfile.mkdtemp(prefix="costabots-manager-v130-hours-"))
    write_sources(output / "recovery-v130", baseline)
    write_sources(output / "candidate", candidate)
    write_zip(output / "recovery-v130.zip", baseline)
    write_zip(output / "candidate.zip", candidate)
    legacy_test = normalized(git_file(V130_GIT_BASE, "_shared/reservation-store/supabaseReservationStore.test.ts"))
    old_import = b"from './supabaseReservationStore.ts';"
    new_import = b"from '../candidate/supabase/functions/_shared/reservation-store/supabaseReservationStore.ts';"
    if legacy_test.count(old_import) != 1:
        raise RuntimeError("Cannot relocate v130 store regression tests")
    verification = output / "verification"
    verification.mkdir()
    (verification / "v130Store.test.ts").write_bytes(
        legacy_test.replace(old_import, new_import) + LEGACY_TEST_APPENDIX.encode("utf-8")
    )
    manifest = {
        "v130_git_base": V130_GIT_BASE,
        "hours_commit": HOURS_COMMIT,
        "v130_runtime_sha256_normalized": RUNTIME_SHA256,
        "candidate_files_sha256": {key: sha256(data) for key, data in sorted(candidate.items())},
        "recovery_zip_sha256": sha256((output / "recovery-v130.zip").read_bytes()),
        "candidate_zip_sha256": sha256((output / "candidate.zip").read_bytes()),
        "only_new_actions": sorted(value.decode("ascii") for value in expected_new),
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "files": len(candidate), **manifest}, indent=2))


if __name__ == "__main__":
    main()
