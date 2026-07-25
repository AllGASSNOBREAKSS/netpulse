# NetPulse server discovery and selection specification

Status: Phase 1 design
Current reality: one active Cloudflare anycast fallback; no NetPulse regional
node is supported

## 1. Goals

Discovery selects the endpoint most likely to measure the requested path
without confusing node overload, incompatible software, or poor routing with a
slow user connection. Geographic distance is context, not the decision.

The system must:

- validate endpoint identity, capability, version, health, and freshness;
- probe multiple candidates before high-volume transfer;
- retain compatible backups;
- prefer capacity and route quality over map distance;
- disclose unknown telemetry and degraded single-provider operation;
- fail over only at safe phase boundaries;
- preserve every candidate/probe decision in the Accuracy Passport.

## 2. Directory distribution

The browser loads a signed or integrity-protected versioned directory from the
NetPulse control plane. The checked-in fallback remains available when loading
fails, but the result records that fallback and its limitations.

Directory envelope:

```json
{
  "schemaVersion": 2,
  "revision": "2026-07-25T12:00:00Z-42",
  "publishedAt": "2026-07-25T12:00:00Z",
  "expiresAt": "2026-07-25T12:10:00Z",
  "minimumEngineVersion": "4.1.0",
  "protocolVersions": [1],
  "endpoints": [],
  "coverage": [],
  "signature": {
    "algorithm": "Ed25519",
    "keyId": "directory-2026-01",
    "value": "base64url-signature"
  }
}
```

The client rejects:

- unsupported schema/protocol;
- expired or implausibly future timestamps;
- duplicate endpoint IDs;
- invalid signature when signing is enabled;
- non-HTTPS/WSS production URLs;
- mixed node identities across endpoint URLs;
- missing mandatory capability or limit fields;
- impossible load/capacity values;
- claimed support whose activation evidence is absent.

## 3. Endpoint record

Each endpoint declares:

- stable ID, node ID, region, provider, failure domain, and coarse city/country;
- status: planned, pilot, active, draining, disabled;
- protocol/build compatibility;
- separate IPv4/IPv6 URLs or explicit dual-stack hostnames;
- download, upload, latency, health, capability, version, and optional echo
  URLs;
- nominal limits and independently validated ceiling;
- current health reference and expiry;
- operator and validation revision;
- public privacy/retention policy URL.

`planned` entries are coverage metadata only and MUST NOT be probed or offered
as selectable production servers.

## 4. Discovery phases

### 4.1 Directory eligibility

Before probing, remove candidates that are disabled, planned, expired,
incompatible, missing mandatory capabilities, or outside the requested test
mode.

### 4.2 Shallow probe

When more than four endpoints are eligible, issue one tiny bounded probe to
each with a global time budget. Record:

- DNS/connect/request success only as exposed;
- complete HTTPS duration;
- HTTP status and node/protocol headers;
- health freshness/status;
- address family when observable.

Advance the best four candidates plus a reachable manual selection.

### 4.3 Deep probe

Run at least five sequential latency probes per candidate. Keep successful
samples and failures. Calculate:

```text
availability = successes / attempts
jitter = mean(abs(RTT[i] - RTT[i-1]))
consistency = 1 - clamp(CoV(RTT) / 0.5, 0, 1)
```

Retain median, P90/P95, jitter, CoV, availability, health, load, capacity
headroom, version, family, and stale/unknown facts.

### 4.4 Eligibility after probes

Reject automatic selection when:

- no probe succeeds;
- status is unavailable, disabled, or draining;
- health is stale or explicitly unhealthy;
- protocol/node identity does not match the directory;
- measured available capacity is below the requested profile plus safety
  margin;
- node is admitting no new sessions;
- response evidence is internally inconsistent.

A manually selected endpoint still cannot bypass security, compatibility,
health, or capacity safety gates.

## 5. Ranking

Scores are relative within the candidate set and normalized to 0-1:

```text
quality =
  availability
  * (
      0.30 * median_latency_score
    + 0.15 * p95_latency_score
    + 0.10 * jitter_score
    + 0.10 * consistency_score
    + 0.15 * health_score
    + 0.10 * load_headroom_score
    + 0.10 * capacity_headroom_score
  )
```

Unknown operational telemetry receives a cautious value no higher than 0.50
for that factor and creates a limitation. It never receives a healthy score.
Latency normalization is robust to outliers and MUST use a documented floor
and ceiling so one pathological candidate does not make all others appear
perfect.

Tie-break order:

1. independently validated capacity headroom;
2. lower P95 latency;
3. lower failure-domain concentration;
4. lower current load;
5. deterministic endpoint ID.

Approximate distance is displayed only when both coarse client and server
locations come from documented sources. It is never a score input by default.

## 6. Selection explanation

The user-visible record contains:

- selected provider and region;
- median/P95 probe latency and jitter;
- reachability and address family;
- health, load, and available capacity or "unavailable";
- selection score;
- concise explanation of the strongest decision factors;
- up to three alternatives with the reason each ranked lower;
- manual/automatic selection state;
- directory revision and fallback warning.

Example:

> Selected US East / provider A because it had the lowest P95 probe latency,
> current healthy capacity headroom, and no failed probes. Western Europe /
> provider B was retained as an independent backup. Load telemetry for the
> Cloudflare fallback was unavailable.

## 7. Failover

The browser keeps at least two compatible backups when they exist.

- Before bulk traffic: a failed primary MAY move to the best backup and
  discovery records the change.
- During warm-up: the run MAY restart the direction on a backup after clearing
  all partial evidence.
- During measured throughput: the run MUST fail/invalidate that phase. It MUST
  NOT combine bytes or time from two endpoints into one headline.
- Between download and upload: an endpoint change requires either a complete
  fresh run or separately labeled per-direction endpoint results; the default
  product should offer a fresh run.
- After completion: secondary verification is a separate measurement, not
  failover.

Regional fallback is visibly disclosed. If every validated endpoint is
overloaded or incompatible, the system stops or offers low-data retry; it
never returns a fabricated slow speed.

## 8. Secondary verification and truth mode

Verification candidates should differ by provider and failure domain when
possible. A backup on the same anycast hostname is not independent.

For bounded primary `P` and secondary `S` capacity:

```text
difference_pct = 100 * abs(P - S) / max(P, S)
```

Status thresholds are methodology-versioned. The current 25% agreement
threshold is provisional and not a certification gate.

Truth mode rules:

- preserve each server result and route context;
- report min/median/max and dispersion only when at least three independently
  validated nodes complete;
- never choose the largest value merely because it is largest;
- never average incompatible methods or directional endpoints;
- flag a node whose controlled probe or health telemetry indicates
  saturation;
- distinguish route-specific disagreement from client instability;
- reduce confidence and offer retest when disagreement exceeds threshold.

## 9. Health removal and re-entry

The control plane removes a node from automatic selection after consecutive
failures from at least two independent monitors or an explicit drain signal.
One user failure alone does not globally remove a node.

Re-entry requires:

- current compatible health;
- successful external canary probes;
- capacity headroom;
- no active incident/rollback;
- minimum observation window;
- directory revision publication.

Directory rollout uses canary publication, signature verification, rapid
rollback, and old-client compatibility. A compromised key or manifest triggers
key revocation and fallback-only mode.

## 10. Manual selection

Advanced users may choose among active compatible endpoints. The interface
shows expected data use and warns when the choice is distant, overloaded, lacks
telemetry, or removes independent backup options. Manual selection is recorded
in the passport and must not be presented as the automatic best endpoint.

## 11. Privacy

Discovery does not need exact client coordinates. Coarse IP-derived region may
be used for candidate reduction only when consent and provider policy allow.
The directory contains no private hostnames, credentials, internal addresses,
or account data.

Probe evidence stored in the result excludes:

- full public IP;
- exact coordinates;
- cache-busting/session secrets;
- raw response headers outside a strict allowlist;
- internal health or observability URLs.

## 12. Rollout

Proposed first pilot: US East with two failure-independent nodes and one second
provider used for validation. Expansion to Western Europe, Australia, and
Southeast Asia follows only after the US East protocol, capacity, failure,
privacy, and accuracy gates pass.

All other named regions remain planned. This document does not activate
coverage, authorize infrastructure purchase, or permit a public node.
