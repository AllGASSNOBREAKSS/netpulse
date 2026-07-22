# NetPulse controlled validation lab

This isolated Linux network connects a browser, traffic shaper, and measurement endpoint. It records real NetPulse browser measurements and independent iperf3/ping baselines. It never inserts sample results into the product or dashboard.

## Prerequisites

- Docker Desktop with its Linux daemon running.
- Disk space for pinned Node, Alpine, and Playwright images.
- Hardware headroom above the tier under test; a 1 Gbps NIC cannot validate 2.5/5 Gbps.
- Real host/device runners for native Chrome, Edge, Firefox, Safari, Android, and iOS certification.

The runner pins Playwright and its official Ubuntu image to 1.61.0. Playwright requires package and image versions to match. WebKit results are engine coverage, not Safari certification.

## Topology

```text
Playwright browser / baseline client (172.29.0.0/24)
                    |
          shaper + TCP/UDP proxy
       download egress | upload egress
                    |
 endpoint HTTP/WebSocket + iperf3 + UDP echo (172.30.0.0/24)
```

The shaper applies half the configured RTT on each egress direction. Download rate applies toward the client and upload rate toward the endpoint. Linux `netem` supplies delay, jitter, random loss, rate, and queue depth. Kernel timer granularity and TCP Small Queues can produce bursts, so the observed baseline—not the configured value—is used for error calculations.

## Start and inspect

```powershell
./lab/scripts/Start-Lab.ps1 -Build
docker compose -f ./lab/compose.yml ps
curl.exe http://127.0.0.1:8088/v1/health
```

Endpoint health reports real active-request load and version. Bandwidth capacity remains `null` because process responsiveness is not proof of spare capacity.

The endpoint also exposes `/v1/echo`, a bounded WebSocket application-message echo used to validate delivery, lateness, and observable reordering. Because WebSocket uses reliable TCP, this is not the UDP packet-loss baseline; iperf3/UDP remains the independent loss baseline.

## Apply a condition

```powershell
./lab/scripts/Set-LabProfile.ps1 `
  -DownloadMbps 100 -UploadMbps 20 -RoundTripMs 50 `
  -JitterMs 10 -PacketLossPct 1 -QueuePackets 100
```

`profiles.json` defines 1, 5, 10, 25, 50, 100, 500, 1,000, 2,500, and 5,000 Mbps tiers; 5, 20, 50, 100, 200, and 300 ms RTTs; plus jitter, loss, deep queues, and failure cases.

## Run matrices

Fast structural smoke:

```powershell
./lab/scripts/Run-NetPulseMatrix.ps1 -Matrix smoke -Repetitions 3 -Browsers chromium,firefox,webkit
```

Full clean/jitter/loss/deep-queue matrix:

```powershell
./lab/scripts/Run-NetPulseMatrix.ps1 -Matrix full -Repetitions 10 -Browsers chromium,firefox,webkit
```

Each condition records reverse/forward iperf3 throughput, routed ping RTT/jitter, and ping under iperf3 download/upload saturation before NetPulse runs. Output retains failures, baseline inputs, time to stable, bytes, duration, confidence, long tasks, frame delay, heap where exposed, and unavailable reasons.

`full` is intentionally expensive: 10 speed tiers × 6 RTTs × 4 impairment profiles × browsers × repetitions, plus baselines. Split it into scoped CI jobs before routine use. The script warns but does not certify multi-gigabit hardware.

## Saturation and bufferbloat

```powershell
$session = ./lab/scripts/Start-LabSaturation.ps1 -Direction both -DurationSeconds 120 | ConvertFrom-Json
# run a selected test while traffic is active
./lab/scripts/Stop-LabSaturation.ps1 -ContainerName $session.Containers
```

The independent bufferbloat baseline uses ping under directional iperf3 saturation. NetPulse bufferbloat remains its own loaded HTTPS median minus idle HTTPS median.

## Endpoint and intermittent failure

```powershell
./lab/scripts/Set-LabFault.ps1 -Mode endpoint-failure
./lab/scripts/Set-LabFault.ps1 -Mode healthy
./lab/scripts/Set-LabFault.ps1 -Mode intermittent-outage -OutageSeconds 3
```

Run intermittent failure from a second terminal so it overlaps a measurement. Failed attempts must remain in the result set.

## Mid-run path-quality change

```powershell
./lab/scripts/Invoke-LabPathQualityChange.ps1 -AfterSeconds 5 `
  -DownloadMbps 25 -UploadMbps 5 -RoundTripMs 200 -JitterMs 30 -PacketLossPct 2
```

This changes controlled path quality. It does not emulate BGP convergence, change an actual route, or give the browser route visibility. A true route-change study needs two routed gateways and independent path capture.

## Internal dashboard

```powershell
npm run lab:dashboard
```

Open `http://127.0.0.1:5178/#/internal/validation`, then choose files from `lab/results/`. The development-only route starts empty, processes files locally, rejects duplicate/private/malformed rows, and provides exact tables under each chart. Results are Git-ignored.

## Cross-platform evidence

The container runner covers Chromium, Firefox, and WebKit on Linux. It does not certify native Chrome, Edge, Safari, Windows, macOS, Android, iOS, Wi-Fi, mobile radio, VPN, battery saver, IPv6, low-power hardware, or background-tab policies. Real-device runners must export the same schema without relabeling Playwright engines as native browsers.

## Comparative testing

Record competitor results beside, not inside, NetPulse run records. Preserve timestamp, endpoint/region, mode, streams where disclosed, browser/device, and route. Use iperf3/ping as controlled baseline. Explain disagreements by endpoint, capacity, route, streams, duration, payload, congestion control, Wi-Fi, browser limits, and aggregation; never tune NetPulse to copy another service.

## Stop

```powershell
docker compose -f ./lab/compose.yml down
```

This removes only lab containers and networks. Result files remain local until deliberately deleted.
