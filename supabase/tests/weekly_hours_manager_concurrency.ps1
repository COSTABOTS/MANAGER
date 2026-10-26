param(
  [Parameter(Mandatory = $true)][string]$PsqlPath,
  [int]$Port = 55501,
  [string]$Database = 'weekly_test'
)

$ErrorActionPreference = 'Stop'
if ($Database -ne 'weekly_test' -or -not (Test-Path -LiteralPath $PsqlPath)) {
  throw 'Disposable weekly_test and an existing psql executable are required.'
}

function Invoke-LocalSql([string]$Sql) {
  $output = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -At -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
  return ($output | Out-String).Trim()
}

$identity = Invoke-LocalSql "select concat_ws('|',current_database(),host(inet_server_addr()),current_setting('server_version_num'),coalesce(current_setting('costabots.weekly_test',true),''),coalesce(current_setting('costabots.weekly_server_ip',true),''))"
$parts = $identity.Split('|')
$localServer = $parts.Count -eq 5 -and $parts[1] -eq '127.0.0.1'
$verifiedCiServer = $parts.Count -eq 5 -and $parts[1] -match '^172\.(1[6-9]|2[0-9]|3[01])\.' -and $parts[3] -eq 'gha-isolated-postgres16' -and $parts[4] -eq $parts[1]
if ($parts.Count -ne 5 -or $parts[0] -ne 'weekly_test' -or $parts[2] -notmatch '^16\d{4}$' -or (-not $localServer -and -not $verifiedCiServer)) {
  throw "Unexpected PostgreSQL test environment: $identity"
}
if ((Invoke-LocalSql "select count(*) from public.booking_service_hours where client_id='TEST-WEEKLY-HOURS'") -ne '0') {
  throw 'The test tenant must start without weekly rules.'
}

$revision = Invoke-LocalSql "select public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision'"
if ($revision -notmatch '^[a-f0-9]{64}$') { throw 'Invalid initial revision.' }
$payloadA = "(select jsonb_agg(jsonb_build_object('weekday',d,'service',s,'enabled',d=0 and s='ALMUERZO','start_time',case when d=0 and s='ALMUERZO' then '11:00' else null end,'end_time',case when d=0 and s='ALMUERZO' then '18:00' else null end)) from generate_series(0,6) d cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s)"
$payloadB = "(select jsonb_agg(jsonb_build_object('weekday',d,'service',s,'enabled',d=0 and s='ALMUERZO','start_time',case when d=0 and s='ALMUERZO' then '12:00' else null end,'end_time',case when d=0 and s='ALMUERZO' then '17:00' else null end)) from generate_series(0,6) d cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s)"
$writerSql = "begin; select public.replace_booking_service_hours('TEST-WEEKLY-HOURS',$payloadA,'$revision'); select pg_sleep(3); commit;"
$job = Start-Job -ScriptBlock {
  param($binary,$port,$database,$sql)
  $result = & $binary -h 127.0.0.1 -p $port -U postgres -d $database -v ON_ERROR_STOP=1 -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($result | Out-String) }
} -ArgumentList $PsqlPath,$Port,$Database,$writerSql

try {
  $locked = $false
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if ([int](Invoke-LocalSql "select count(*) from pg_locks where locktype='advisory' and mode='ExclusiveLock' and granted and pid<>pg_backend_pid()") -gt 0) {
      $locked = $true
      break
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $locked) { throw 'The first writer did not acquire the tenant advisory lock.' }

  $loser = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -c "select public.replace_booking_service_hours('TEST-WEEKLY-HOURS',$payloadB,'$revision')" 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0 -or $loser -notmatch 'WEEKLY_HOURS_CONFLICT') {
    throw "The second writer did not receive a conflict: $loser"
  }
  Wait-Job $job | Out-Null
  Receive-Job $job -ErrorAction Stop | Out-Null

  $winner = Invoke-LocalSql "select count(*) || '|' || min(start_time)::text || '|' || min(end_time)::text from public.booking_service_hours where client_id='TEST-WEEKLY-HOURS' and enabled"
  if ($winner -ne '1|11:00:00|18:00:00') { throw "The winning schedule was overwritten: $winner" }
  if ((Invoke-LocalSql "select count(*) from public.booking_service_hours where client_id='TEST-WEEKLY-HOURS'") -ne '21') {
    throw 'The concurrent write left a partial schedule.'
  }

  $freshRevision = Invoke-LocalSql "select public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision'"
  if ($freshRevision -eq $revision) { throw 'Revision did not advance after the first write.' }
  Invoke-LocalSql "select public.replace_booking_service_hours('TEST-WEEKLY-HOURS',$payloadB,'$freshRevision')" | Out-Null
  $retry = Invoke-LocalSql "select min(start_time)::text || '|' || min(end_time)::text from public.booking_service_hours where client_id='TEST-WEEKLY-HOURS' and enabled"
  if ($retry -ne '12:00:00|17:00:00') { throw "Retry with a fresh revision failed: $retry" }
  Write-Output 'CAS_CONCURRENCY_PASS: first writer won; second conflicted; 21 rows retained; retry succeeded.'
} finally {
  if ($job.State -eq 'Running') { Wait-Job $job | Out-Null }
  Receive-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -Force
}
