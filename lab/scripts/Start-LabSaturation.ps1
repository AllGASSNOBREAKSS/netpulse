param(
  [Parameter(Mandatory)][ValidateSet("download", "upload", "both")][string]$Direction,
  [ValidateRange(5, 3600)][int]$DurationSeconds = 120,
  [ValidateRange(1, 16)][int]$Streams = 4
)

$ErrorActionPreference = "Stop"
$compose = Join-Path $PSScriptRoot "..\compose.yml"
$directions = if ($Direction -eq "both") { @("download", "upload") } else { @($Direction) }
$containers = foreach ($item in $directions) {
  $name = "netpulse-lab-background-$item-$([Guid]::NewGuid().ToString('N'))"
  $arguments = @("compose", "-f", $compose, "--profile", "runner", "run", "-d", "--name", $name, "saturator", "-c", "shaper", "-p", "5201", "-t", $DurationSeconds, "-P", $Streams)
  if ($item -eq "download") { $arguments += "-R" }
  & docker @arguments > $null
  if ($LASTEXITCODE -ne 0) { throw "The $item saturation stream could not start." }
  $name
}

[pscustomobject]@{ Direction = $Direction; Containers = @($containers); DurationSeconds = $DurationSeconds } | ConvertTo-Json -Compress
