param(
  [Parameter(Mandatory)][ValidateSet("healthy", "endpoint-failure", "intermittent-outage")][string]$Mode,
  [int]$OutageSeconds = 3
)

$ErrorActionPreference = "Stop"
$compose = Join-Path $PSScriptRoot "..\compose.yml"
switch ($Mode) {
  "healthy" { & docker compose -f $compose unpause endpoint }
  "endpoint-failure" { & docker compose -f $compose stop endpoint }
  "intermittent-outage" {
    & docker compose -f $compose pause endpoint
    Start-Sleep -Seconds $OutageSeconds
    & docker compose -f $compose unpause endpoint
  }
}
if ($LASTEXITCODE -ne 0) { throw "Fault mode $Mode could not be applied." }
