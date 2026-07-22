param(
  [ValidateSet("smoke", "full")][string]$Matrix = "smoke",
  [ValidateRange(1, 100)][int]$Repetitions = 3,
  [ValidateSet("chromium", "firefox", "webkit")][string[]]$Browsers = @("chromium")
)

$ErrorActionPreference = "Stop"
$labRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $labRoot "..")
$compose = Join-Path $labRoot "compose.yml"
$profiles = Get-Content -Raw -LiteralPath (Join-Path $labRoot "profiles.json") | ConvertFrom-Json
$revision = (& git -C $repoRoot rev-parse --short HEAD).Trim()
if (& git -C $repoRoot status --porcelain) { $revision = "$revision-dirty" }

function Invoke-Iperf {
  param([switch]$Reverse)
  $arguments = @("compose", "-f", $compose, "--profile", "runner", "run", "--rm", "baseline", "iperf3", "-c", "shaper", "-p", "5201", "-J", "-t", "8", "-O", "1")
  if ($Reverse) { $arguments += "-R" }
  $raw = (& docker @arguments) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw "iperf3 baseline failed." }
  $start = $raw.IndexOf("{")
  if ($start -lt 0) { throw "iperf3 did not return JSON." }
  $json = $raw.Substring($start) | ConvertFrom-Json
  return [math]::Round([double]$json.end.sum_received.bits_per_second / 1000000, 4)
}

function Invoke-PingBaseline {
  $raw = (& docker compose -f $compose --profile runner run --rm baseline sh -lc "ip route add 172.30.0.0/24 via 172.29.0.2; ping -n -c 20 -W 3 172.30.0.10") -join "`n"
  if ($LASTEXITCODE -ne 0) { throw "Ping baseline failed." }
  $samples = [regex]::Matches($raw, 'time[=<]([0-9.]+) ms') | ForEach-Object { [double]$_.Groups[1].Value }
  if ($samples.Count -lt 10) { throw "Ping baseline returned fewer than ten RTT samples." }
  $sorted = @($samples | Sort-Object)
  $mid = [int][math]::Floor($sorted.Count / 2)
  $median = if ($sorted.Count % 2) { $sorted[$mid] } else { ($sorted[$mid - 1] + $sorted[$mid]) / 2 }
  $differences = for ($index = 1; $index -lt $samples.Count; $index += 1) { [math]::Abs($samples[$index] - $samples[$index - 1]) }
  return @{ Median = [math]::Round($median, 4); Jitter = [math]::Round(($differences | Measure-Object -Average).Average, 4) }
}

function Invoke-UdpPacketLossBaseline {
  param([Parameter(Mandatory)][double]$TargetMbps)
  $bandwidthMbps = [math]::Max(0.1, [math]::Round($TargetMbps * 0.8, 3))
  $command = "ip route add 172.30.0.0/24 via 172.29.0.2 2>/dev/null || true; iperf3 -c 172.30.0.10 -p 5201 -u -b $($bandwidthMbps)M -J -t 8 -O 1"
  $raw = (& docker compose -f $compose --profile runner run --rm baseline sh -lc $command) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw "UDP packet-loss baseline failed." }
  $start = $raw.IndexOf("{")
  if ($start -lt 0) { throw "UDP iperf3 did not return JSON." }
  $json = $raw.Substring($start) | ConvertFrom-Json
  $summary = if ($null -ne $json.end.sum) { $json.end.sum } elseif ($null -ne $json.end.sum_received) { $json.end.sum_received } else { $null }
  if ($null -eq $summary -or $null -eq $summary.lost_percent) { throw "UDP iperf3 did not report observed packet loss." }
  return [math]::Round([double]$summary.lost_percent, 4)
}

function Invoke-LoadedPingBaseline {
  param([Parameter(Mandatory)][ValidateSet("download", "upload")][string]$Direction)
  $containerName = "netpulse-lab-$Direction-$([Guid]::NewGuid().ToString('N'))"
  $arguments = @("compose", "-f", $compose, "--profile", "runner", "run", "-d", "--name", $containerName, "saturator", "-c", "shaper", "-p", "5201", "-t", "20", "-P", "4")
  if ($Direction -eq "download") { $arguments += "-R" }
  try {
    & docker @arguments > $null
    if ($LASTEXITCODE -ne 0) { throw "The $Direction saturation baseline could not start." }
    Start-Sleep -Seconds 2
    return Invoke-PingBaseline
  } finally {
    & docker rm -f $containerName > $null 2>&1
  }
}

function ConvertTo-Base64Json {
  param([Parameter(Mandatory)]$Value)
  $json = $Value | ConvertTo-Json -Compress -Depth 10
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
}

& (Join-Path $PSScriptRoot "Start-Lab.ps1") -Build
$speedTiers = if ($Matrix -eq "smoke") { @($profiles.speedTiers | Where-Object smoke) } else { @($profiles.speedTiers) }
$latencies = if ($Matrix -eq "smoke") { @(20) } else { @($profiles.latencyMs) }
$impairments = if ($Matrix -eq "smoke") { @($profiles.impairments | Where-Object id -eq "clean") } else { @($profiles.impairments | Where-Object fault -eq "none") }

foreach ($tier in $speedTiers) {
  if ($tier.requiresHardwareCertification -and $Matrix -eq "full") {
    Write-Warning "Running $($tier.id) requires independently verified NIC, switch, host CPU, and endpoint headroom. Results are not certified by this script."
  }
  foreach ($latency in $latencies) {
    foreach ($impairment in $impairments) {
      & (Join-Path $PSScriptRoot "Set-LabProfile.ps1") `
        -DownloadMbps $tier.downloadMbps -UploadMbps $tier.uploadMbps -RoundTripMs $latency `
        -JitterMs $impairment.jitterMs -PacketLossPct $impairment.packetLossPct -QueuePackets $impairment.queuePackets

      $downloadBaseline = Invoke-Iperf -Reverse
      $uploadBaseline = Invoke-Iperf
      $pingBaseline = Invoke-PingBaseline
      $packetLossBaseline = Invoke-UdpPacketLossBaseline -TargetMbps ([double]$tier.uploadMbps)
      $loadedDownloadBaseline = Invoke-LoadedPingBaseline -Direction download
      $loadedUploadBaseline = Invoke-LoadedPingBaseline -Direction upload
      $baseline = @{
        source = "iperf3-and-ping"
        downloadMbps = $downloadBaseline
        uploadMbps = $uploadBaseline
        idleLatencyMs = $pingBaseline.Median
        jitterMs = $pingBaseline.Jitter
        packetLossPct = $packetLossBaseline
        bufferbloatDownMs = [math]::Max(0, $loadedDownloadBaseline.Median - $pingBaseline.Median)
        bufferbloatUpMs = [math]::Max(0, $loadedUploadBaseline.Median - $pingBaseline.Median)
      }
      $condition = @{
        profileId = "$($tier.id)-rtt$latency-$($impairment.id)"
        downloadMbps = [double]$tier.downloadMbps
        uploadMbps = [double]$tier.uploadMbps
        roundTripMs = [double]$latency
        jitterMs = [double]$impairment.jitterMs
        packetLossPct = [double]$impairment.packetLossPct
        saturation = [string]$impairment.saturation
        fault = [string]$impairment.fault
      }
      $condition64 = ConvertTo-Base64Json $condition
      $baseline64 = ConvertTo-Base64Json $baseline

      foreach ($browser in $Browsers) {
        for ($repeat = 1; $repeat -le $Repetitions; $repeat += 1) {
          $runId = "$($condition.profileId)-$browser-r$repeat-$(Get-Date -Format 'yyyyMMddHHmmssfff')"
          & docker compose -f $compose --profile runner run --rm `
            -e "NETPULSE_LAB_BROWSER=$browser" `
            -e "NETPULSE_LAB_RUN_ID=$runId" `
            -e "NETPULSE_LAB_CONDITION_B64=$condition64" `
            -e "NETPULSE_LAB_BASELINE_B64=$baseline64" `
            -e "NETPULSE_LAB_REVISION=$revision" runner
          if ($LASTEXITCODE -ne 0) { Write-Warning "Run $runId failed and was retained as a failure record." }
        }
      }
    }
  }
}
