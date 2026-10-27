param(
  [Parameter(Mandatory = $true)][string]$PsqlPath,
  [int]$Port = 5432,
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
$tenant = 'TEST-POOL-CONCURRENT'
if ((Invoke-LocalSql "select count(*) from public.booking_pool_hours where client_id='$tenant'") -ne '0') {
  throw 'Pool concurrency tenant must start without configuration.'
}
Invoke-LocalSql ('insert into public."CLIENTES" (client_id) values (''{0}'')' -f $tenant) | Out-Null
$writerSql = "begin; select public.replace_booking_pool_hours('$tenant','10:00','19:00',null); select pg_sleep(3); commit;"
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
  if (-not $locked) { throw 'First pool writer did not acquire its tenant lock.' }
  $loser = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -c "select public.replace_booking_pool_hours('$tenant','11:00','20:00',null)" 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0 -or $loser -notmatch 'POOL_HOURS_CONFLICT') {
    throw "Second pool writer did not receive a conflict: $loser"
  }
  Wait-Job $job | Out-Null
  Receive-Job $job -ErrorAction Stop | Out-Null
  $snapshot = Invoke-LocalSql "select opening_time::text || '|' || closing_time::text from public.booking_pool_hours where client_id='$tenant'"
  if ($snapshot -ne '10:00:00|19:00:00') { throw "Pool winner was overwritten: $snapshot" }
  Write-Output 'POOL_CAS_CONCURRENCY_PASS: one writer won; stale writer conflicted.'
} finally {
  if ($job.State -eq 'Running') { Wait-Job $job | Out-Null }
  Receive-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -Force
}
