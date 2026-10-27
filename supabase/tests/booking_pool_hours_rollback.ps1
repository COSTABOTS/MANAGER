param(
  [Parameter(Mandatory = $true)][string]$PsqlPath,
  [int]$Port = 5432,
  [string]$Database = 'weekly_test'
)

$ErrorActionPreference = 'Stop'
if ($Database -ne 'weekly_test' -or -not (Test-Path -LiteralPath $PsqlPath)) {
  throw 'Disposable weekly_test and an existing psql executable are required.'
}
$rollbackPath = Join-Path $PSScriptRoot '../rollbacks/20261027120000_booking_pool_hours.sql'
if (-not (Test-Path -LiteralPath $rollbackPath)) { throw 'Pool rollback script missing.' }

function Invoke-LocalSql([string]$Sql) {
  $output = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -At -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
  return ($output | Out-String).Trim()
}
function Invoke-Rollback([string]$ExtraOptions) {
  $original = $env:PGOPTIONS
  try {
    $env:PGOPTIONS = "$original $ExtraOptions".Trim()
    $output = & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -f $rollbackPath 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Output = $output }
  } finally {
    $env:PGOPTIONS = $original
  }
}

$identity = Invoke-LocalSql "select concat_ws('|',current_database(),host(inet_server_addr()),current_setting('server_version_num'),coalesce(current_setting('costabots.weekly_test',true),''),coalesce(current_setting('costabots.weekly_server_ip',true),''))"
$parts = $identity.Split('|')
$localServer = $parts.Count -eq 5 -and $parts[1] -eq '127.0.0.1'
$verifiedCiServer = $parts.Count -eq 5 -and $parts[1] -match '^172\.(1[6-9]|2[0-9]|3[01])\.' -and $parts[3] -eq 'gha-isolated-postgres16' -and $parts[4] -eq $parts[1]
if ($parts.Count -ne 5 -or $parts[0] -ne 'weekly_test' -or $parts[2] -notmatch '^16\d{4}$' -or (-not $localServer -and -not $verifiedCiServer)) {
  throw "Unexpected PostgreSQL test environment: $identity"
}
if ((Invoke-LocalSql "select count(*) from public.booking_pool_hours") -ne '1') {
  throw 'Expected only the fixture row left by the concurrency test.'
}
Invoke-LocalSql "delete from public.booking_pool_hours where client_id='TEST-POOL-CONCURRENT'" | Out-Null
if ((Invoke-LocalSql "select count(*) from public.booking_pool_hours") -ne '0') {
  throw 'Could not remove the disposable concurrency fixture.'
}

$missingMarker = Invoke-Rollback ''
if ($missingMarker.Code -eq 0 -or $missingMarker.Output -notmatch 'explicit reviewed session marker') {
  throw "Rollback without authorization marker did not fail safely: $($missingMarker.Output)"
}
$allowMarker = '-c costabots.allow_pool_hours_rollback=reviewed-no-active-consumers'
$consumersNotDisabled = Invoke-Rollback $allowMarker
if ($consumersNotDisabled.Code -eq 0 -or $consumersNotDisabled.Output -notmatch 'disabled consumers confirmation') {
  throw "Rollback without disabled consumers confirmation did not fail safely: $($consumersNotDisabled.Output)"
}
if ((Invoke-LocalSql "select count(*) from public.booking_pool_hours") -ne '0') {
  throw 'Rejected rollback changed the table.'
}

Invoke-LocalSql 'insert into public."CLIENTES" (client_id) values (''TEST-POOL-ROLLBACK'')' | Out-Null
Invoke-LocalSql "select public.replace_booking_pool_hours('TEST-POOL-ROLLBACK','10:00','19:00',null)" | Out-Null
$bothMarkers = "$allowMarker -c costabots.pool_hours_consumers_disabled=confirmed"
$populated = Invoke-Rollback $bothMarkers
if ($populated.Code -eq 0 -or $populated.Output -notmatch 'refuses to discard configured tenants') {
  throw "Rollback with tenant data did not fail safely: $($populated.Output)"
}
if ((Invoke-LocalSql "select count(*) from public.booking_pool_hours where client_id='TEST-POOL-ROLLBACK'") -ne '1') {
  throw 'Failed rollback lost the configured tenant.'
}
Invoke-LocalSql "delete from public.booking_pool_hours where client_id='TEST-POOL-ROLLBACK'" | Out-Null
$empty = Invoke-Rollback $bothMarkers
if ($empty.Code -ne 0) { throw "Authorized empty-table rollback failed: $($empty.Output)" }
if ((Invoke-LocalSql "select (to_regclass('public.booking_pool_hours') is null)::text || '|' || (to_regprocedure('public.replace_booking_pool_hours(text,text,text,text)') is null)::text") -ne 'true|true') {
  throw 'Rollback left the pool table or RPC behind.'
}
Write-Output 'POOL_ROLLBACK_PASS: missing markers, active consumers and populated table refused; empty rollback succeeded.'
