param([switch]$Build)

$ErrorActionPreference = "Stop"
$compose = Join-Path $PSScriptRoot "..\compose.yml"
$arguments = @("compose", "-f", $compose, "up", "-d")
if ($Build) { $arguments += "--build" }
$arguments += @("endpoint", "shaper", "app")
& docker @arguments
if ($LASTEXITCODE -ne 0) { throw "The validation lab did not start." }
& docker compose -f $compose ps
