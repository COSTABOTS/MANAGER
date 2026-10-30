param(
  [Parameter(Mandatory = $true)][string]$PsqlPath,
  [int]$Port = 5432,
  [string]$Database = 'weekly_rpc_test'
)

$ErrorActionPreference = 'Stop'
if ($Database -ne 'weekly_rpc_test' -or -not (Test-Path -LiteralPath $PsqlPath)) {
  throw 'Only the disposable weekly_rpc_test database is permitted.'
}

function Sql([string]$Statement) {
  $output = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -A -t -c $Statement 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
  return ($output | Out-String).Trim()
}

function Reset-Fixture {
  $fixture = Join-Path $PSScriptRoot 'weekly_reservation_rpc_concurrency_setup.sql'
  & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -f $fixture | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Disposable fixture failed.' }
  Sql 'insert into public."SETTINGS"("CLIENTE_ID","CLAVE","VALOR") values (''TEST-RPC-WEEKLY'',''BOOKING_INTERVAL'',''30'')' | Out-Null
}

function Wait-SlotLock {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $count = Sql "select count(*) from pg_locks where locktype='advisory' and mode='ExclusiveLock' and granted and pid<>pg_backend_pid()"
    if ([int]$count -gt 0) { return }
    Start-Sleep -Milliseconds 100
  }
  throw 'The first transaction did not acquire its slot lock.'
}

function Start-Reservation([string]$Statement) {
  return Start-Job -ScriptBlock {
    param($binary,$port,$database,$statement)
    $output = & $binary -h 127.0.0.1 -p $port -U postgres -d $database -v ON_ERROR_STOP=1 -c "begin; $statement; select pg_sleep(2); commit;" 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
  } -ArgumentList $PsqlPath,$Port,$Database,$Statement
}

$bookingSunday = Sql "select (d + ((7 - extract(dow from d)::integer) % 7))::text from (select (clock_timestamp() at time zone 'Europe/Madrid')::date + 14 as d) future"
$manual = "insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel) values ('TEST-RPC-WEEKLY','$bookingSunday','17:00','ALMUERZO',1,'manager_manual')"
$payload = "{`"booking_date`":`"$bookingSunday`",`"booking_time`":`"17:00`",`"service`":`"ALMUERZO`",`"pax`":1}"
$public = "select public.create_hospitality_reservation('TEST-RPC-WEEKLY','internal-public-concurrent','$payload'::jsonb)"

Reset-Fixture
$first = Start-Reservation $manual
Wait-SlotLock
$rejected = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -c $public 2>&1 | Out-String
if ($LASTEXITCODE -eq 0 -or $rejected -notmatch 'AVAILABILITY_EXHAUSTED') { throw 'Public booking ignored the concurrent manual reservation.' }
Wait-Job $first | Out-Null
Receive-Job $first -ErrorAction Stop | Out-Null
if ((Sql "select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY' and booking_date='$bookingSunday' and booking_time='17:00'") -ne '1') { throw 'Manual-first race did not retain exactly one booking.' }
if ((Sql "select count(*) from public.booking_idempotency where client_id='TEST-RPC-WEEKLY' and idempotency_key='internal-public-concurrent'") -ne '0') { throw 'Rejected public booking persisted idempotency.' }

Reset-Fixture
$first = Start-Reservation $public
Wait-SlotLock
$rejected = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -c $manual 2>&1 | Out-String
if ($LASTEXITCODE -eq 0 -or $rejected -notmatch 'AVAILABILITY_EXHAUSTED') { throw 'Manual booking ignored the concurrent public reservation.' }
Wait-Job $first | Out-Null
Receive-Job $first -ErrorAction Stop | Out-Null
if ((Sql "select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY' and booking_date='$bookingSunday' and booking_time='17:00'") -ne '1') { throw 'Public-first race did not retain exactly one booking.' }
Write-Output 'INTERNAL_CAPACITY_CONCURRENCY_PASS: both orders keep exactly one booking and reject the second without persistent idempotency.'
