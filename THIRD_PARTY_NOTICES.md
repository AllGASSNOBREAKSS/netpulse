# Third-party notices and technical references

NetPulse is independently implemented and licensed under AGPL-3.0-only. The projects below were reviewed for general architectural and measurement ideas. No source code, protected assets, branding, private API, or credentials were copied into NetPulse during this integration phase.

The current research matrix and service/standards boundaries are maintained in
[REFERENCE_INTEGRATION_AUDIT.md](REFERENCE_INTEGRATION_AUDIT.md). A project
being listed here does not mean it is bundled, executed, endorsed, or used as
measurement ground truth.

## Speedtest Tracker (legacy)

- Source: <https://github.com/henrywhitaker3/Speedtest-Tracker>
- Audited commit: `8cb2e8a3236850b4a07e887ac376c0d4d5e804f4`
- License: GNU General Public License v3.0
- Files reviewed: `LICENSE`, `app/Jobs/SpeedtestJob.php`, `app/Interfaces/SpeedtestProvider.php`, `app/Helpers/SpeedtestHelper.php`, result/history and notification code.
- Influence: queued execution, provider boundaries, failure events, historical thresholds.
- Modifications/reuse: concepts independently reimplemented; no copied code.

## speedtest-cli

- Source: <https://github.com/sivel/speedtest-cli>
- Audited commit: `22210ca35228f0bbcef75a7c14587c4ecb875ab4`
- License: Apache License 2.0
- Files reviewed: `LICENSE`, `README.rst`, `speedtest.py` server selection, downloader, uploader, cancellation, and upload preallocation.
- Influence: preallocated upload data, monotonic timing, bounded concurrent transfers, cancellation, and explicit single/multi modes.
- Modifications/reuse: concepts independently reimplemented for browser Fetch and NetPulse endpoints; no copied code or Speedtest.net protocol.

## speed-test

- Source: <https://github.com/sindresorhus/speed-test>
- Audited commit: `200dda1b649eb00864a183912a9720ce2def7ae3`
- License: MIT
- Files reviewed: `license`, `cli.js`, `package.json`, `readme.md`.
- Influence: event-driven progress separated from presentation and distinct machine-readable output.
- Modifications/reuse: concepts independently reimplemented; the `speedtest-net` dependency is not used.

## Speedtest Tracker (current)

- Source: <https://github.com/alexjustesen/speedtest-tracker>
- Audited commit: `166a84a8f5561059a642d1d5943cc0b8bf667534`
- License: MIT
- Files reviewed: `LICENSE.md`, staged Ookla jobs, `ResultStatus`, `Result`, scheduled-service, benchmark, event, API, and test files.
- Influence: staged status transitions, cancellation-aware jobs, raw plus normalized result retention, scheduling, pruning, and thresholds.
- Modifications/reuse: concepts independently reimplemented; fake-result generation, Ookla invocation, and provider-specific schemas are excluded.

## Cloudflare Speedtest

- Source: <https://github.com/cloudflare/speedtest>
- Review date: 2026-07-25
- License: MIT
- Influence: browser Resource Timing, increasing payload sizes, directional
  loaded-latency probes, and the requirement for a configured TURN service
  before reporting packet loss.
- Modifications/reuse: no source code incorporated. NetPulse directly uses
  Cloudflare's public speed endpoint as its only current fallback data plane;
  Cloudflare remains an independent service provider.

## M-Lab NDT7 JavaScript client

- Source: <https://github.com/m-lab/ndt7-js>
- Review date: 2026-07-25
- License: Apache License 2.0
- Influence: versioned WebSocket protocol, locate-based discovery,
  client/server measurement evidence, and explicit data-policy handling.
- Modifications/reuse: no package or source code incorporated and no public
  NetPulse result is silently replaced by NDT7.

## Standards references

- Broadband Forum TR-143, *Enabling Network Throughput Performance Tests and
  Statistical Monitoring*.
- Broadband Forum TR-471, *Maximum IP-Layer Capacity Metric, Related Metrics,
  and Measurements*.

These are technical references. NetPulse does not claim conformance, and their
text is not copied into this repository.

Ookla, Speedtest, Speedtest.net, FAST.com, Netflix, Cloudflare, and M-Lab are names of independent third parties. NetPulse does not claim ownership of their trademarks or affiliation with them.
