param(
  [ValidateRange(1, 300)][int]$AfterSeconds = 5,
  [Parameter(Mandatory)][double]$DownloadMbps,
  [Parameter(Mandatory)][double]$UploadMbps,
  [Parameter(Mandatory)][double]$RoundTripMs,
  [double]$JitterMs = 0,
  [double]$PacketLossPct = 0,
  [int]$QueuePackets = 100
)

Start-Sleep -Seconds $AfterSeconds
& (Join-Path $PSScriptRoot "Set-LabProfile.ps1") `
  -DownloadMbps $DownloadMbps -UploadMbps $UploadMbps -RoundTripMs $RoundTripMs `
  -JitterMs $JitterMs -PacketLossPct $PacketLossPct -QueuePackets $QueuePackets

Write-Warning "This changes controlled path quality during a run; it does not emulate BGP convergence or prove route visibility."
