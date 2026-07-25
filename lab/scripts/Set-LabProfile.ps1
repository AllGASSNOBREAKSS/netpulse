param(
  [Parameter(Mandatory)][double]$DownloadMbps,
  [Parameter(Mandatory)][double]$UploadMbps,
  [Parameter(Mandatory)][double]$RoundTripMs,
  [double]$JitterMs = 0,
  [double]$PacketLossPct = 0,
  [int]$QueuePackets = 100
)

$ErrorActionPreference = "Stop"
$compose = Join-Path $PSScriptRoot "..\compose.yml"
& docker compose -f $compose exec -T shaper /lab/apply-profile.sh $DownloadMbps $UploadMbps $RoundTripMs $JitterMs $PacketLossPct $QueuePackets
if ($LASTEXITCODE -ne 0) { throw "Traffic-control profile could not be applied." }
