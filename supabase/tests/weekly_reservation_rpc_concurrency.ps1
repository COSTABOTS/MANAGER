param(
  [Parameter(Mandatory = $true)][string]$PsqlPath,
  [int]$Port = 55489,
  [string]$Database = 'weekly_rpc_test'
)

$ErrorActionPreference = 'Stop'
if ($Database -notmatch '^weekly_[a-z0-9_]*_test$') {
  throw 'Only a disposable weekly_*_test database is permitted.'
}
if (-not (Test-Path -LiteralPath $PsqlPath)) { throw 'psql executable not found.' }

function Invoke-LocalSql([string]$Sql) {
  $output = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -A -t -F ',' -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Local SQL failed: $($output | Out-String)" }
  return ($output | Out-String).Trim()
}

function Wait-TenantLock([string]$Mode) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $count = Invoke-LocalSql "select count(*) from pg_locks where locktype='advisory' and mode='$Mode' and granted and pid<>pg_backend_pid()"
    if ([int]$count -gt 0) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Expected $Mode advisory lock was not observed."
}

$fixture = Join-Path $PSScriptRoot 'weekly_reservation_rpc_concurrency_setup.sql'
& $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -f $fixture | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Disposable concurrency fixture failed.' }

$bookingSunday = Invoke-LocalSql "select (d + ((7 - extract(dow from d)::integer) % 7))::text from (select (clock_timestamp() at time zone 'Europe/Madrid')::date + 14 as d) future"
$payload17 = @{ booking_date = $bookingSunday; booking_time = '17:00'; service = 'ALMUERZO'; pax = 1 } | ConvertTo-Json -Compress
$createA = "begin; select public.create_hospitality_reservation('TEST-RPC-WEEKLY','concurrent-a','$payload17'::jsonb); select pg_sleep(3); commit;"
$job = Start-Job -ScriptBlock {
  param($binary,$port,$database,$sql)
  $output = & $binary -h 127.0.0.1 -p $port -U postgres -d $database -v ON_ERROR_STOP=1 -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
} -ArgumentList $PsqlPath,$Port,$Database,$createA
Wait-TenantLock 'ExclusiveLock'
$createB = "select public.create_hospitality_reservation('TEST-RPC-WEEKLY','concurrent-b','$payload17'::jsonb)"
$rejected = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -c $createB 2>&1 | Out-String
if ($LASTEXITCODE -eq 0 -or $rejected -notmatch 'AVAILABILITY_EXHAUSTED') { throw "Second slot reservation was not rejected as expected: $rejected" }
Wait-Job $job | Out-Null
Receive-Job $job -ErrorAction Stop | Out-Null
if ((Invoke-LocalSql "select count(*), (select count(*) from public.booking_idempotency where client_id='TEST-RPC-WEEKLY' and idempotency_key in ('concurrent-a','concurrent-b')) from public.reservations where client_id='TEST-RPC-WEEKLY' and booking_time='17:00'") -ne '1,1') {
  throw 'Concurrent last-slot writes or idempotency count is wrong.'
}

$closeRules = "begin; select public.replace_booking_service_hours('TEST-RPC-WEEKLY',(select jsonb_agg(jsonb_build_object('weekday',d.weekday,'service',s.service,'enabled',false,'start_time',null,'end_time',null)) from generate_series(0,6) d(weekday) cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service))); select pg_sleep(3); commit;"
$writer = Start-Job -ScriptBlock {
  param($binary,$port,$database,$sql)
  $output = & $binary -h 127.0.0.1 -p $port -U postgres -d $database -v ON_ERROR_STOP=1 -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
} -ArgumentList $PsqlPath,$Port,$Database,$closeRules
Wait-TenantLock 'ExclusiveLock'
$payload16 = @{ booking_date = $bookingSunday; booking_time = '16:00'; service = 'ALMUERZO'; pax = 1 } | ConvertTo-Json -Compress
$afterClose = "select public.create_hospitality_reservation('TEST-RPC-WEEKLY','after-close','$payload16'::jsonb)"
$rejected = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -c $afterClose 2>&1 | Out-String
if ($LASTEXITCODE -eq 0 -or $rejected -notmatch 'RESERVATION_OUTSIDE_WEEKLY_HOURS') { throw "Reservation passed a concurrent closure: $rejected" }
Wait-Job $writer | Out-Null
Receive-Job $writer -ErrorAction Stop | Out-Null
if ((Invoke-LocalSql "select count(*), (select count(*) from public.booking_idempotency where client_id='TEST-RPC-WEEKLY' and idempotency_key='after-close') from public.reservations where client_id='TEST-RPC-WEEKLY' and booking_time='16:00'") -ne '0,0') {
  throw 'Concurrent closure rejection persisted a reservation or idempotency row.'
}

# Reverse lock order: an in-flight valid reservation completes before the writer closes.
$openRules = "select public.replace_booking_service_hours('TEST-RPC-WEEKLY',(select jsonb_agg(jsonb_build_object('weekday',d.weekday,'service',s.service,'enabled',d.weekday=0 and s.service='ALMUERZO','start_time',case when d.weekday=0 and s.service='ALMUERZO' then '11:00' else null end,'end_time',case when d.weekday=0 and s.service='ALMUERZO' then '18:00' else null end)) from generate_series(0,6) d(weekday) cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service)))"
Invoke-LocalSql $openRules | Out-Null
$createBeforeClose = "begin; select public.create_hospitality_reservation('TEST-RPC-WEEKLY','before-close','$payload16'::jsonb); select pg_sleep(3); commit;"
$reservationJob = Start-Job -ScriptBlock {
  param($binary,$port,$database,$sql)
  $output = & $binary -h 127.0.0.1 -p $port -U postgres -d $database -v ON_ERROR_STOP=1 -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
} -ArgumentList $PsqlPath,$Port,$Database,$createBeforeClose
Wait-TenantLock 'ShareLock'
Invoke-LocalSql $closeRules | Out-Null
Wait-Job $reservationJob | Out-Null
Receive-Job $reservationJob -ErrorAction Stop | Out-Null
if ((Invoke-LocalSql "select count(*), (select count(*) from public.booking_idempotency where client_id='TEST-RPC-WEEKLY' and idempotency_key='before-close') from public.reservations where client_id='TEST-RPC-WEEKLY' and booking_time='16:00'") -ne '1,1') {
  throw 'An in-flight reservation was lost or duplicated during closure.'
}
Write-Output 'CONCURRENCY_PASS: one last-cup reservation; closure-first rejection; reservation-first completion; no deadlock or rejected writes.'
