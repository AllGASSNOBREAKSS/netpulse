# Fix My Internet methodology

Fix My Internet is a local, deterministic troubleshooting workflow built on the
same real measurement engine as NetPulse Speed Test. It does not generate a
cause from the selected symptom. The symptom only changes which controlled
comparisons are recommended first.

## Evidence model

The workflow distinguishes three levels:

1. **Observed impairment** — a direct measurement can establish high latency,
   latency variation, low stability, or queueing under load.
2. **Supported cause candidate** — a cause such as the local wireless path,
   VPN overhead, competing traffic, or a device limit requires a compatible
   A/B pair in which one declared condition changes.
3. **Ownership** — a browser result does not prove which router, modem, access
   link, ISP segment, server, or application owns an impairment unless the
   required independent evidence exists. NetPulse does not currently claim
   ownership.

Every assessment contains its evidence, confidence, alternatives, next test,
action, action unlikely to help, and the exact rule used.

## Saved diagnostic data

Up to 12 diagnostic sessions are stored in browser `localStorage`. A session
contains:

- the selected symptom;
- optional user-entered plan rates;
- user-confirmed conditions such as Wi-Fi/Ethernet, VPN state, location label,
  traffic state, device label, and time label;
- summarized real measurements: throughput, idle/loaded latency, jitter,
  bufferbloat, stability, sample counts, duration, payload, endpoint metadata,
  IP family, limitations, and confidence.

Sessions and exported reports do **not** contain a full public IP, SSID, device
name, browsing history, router credentials, or account credentials. The test
provider still necessarily sees the source IP of HTTPS requests.

## Compatibility gate

A pair can be used by a causal rule only when both runs have at least 45% run
confidence and use the same provider and protocol. A change in reported edge
code reduces the diagnostic-pair confidence by 8 points. Physical conditions
are user-confirmed because browser APIs cannot reliably verify Wi-Fi versus
Ethernet, location, VPN state, background household traffic, or which device is
being used.

## Material-improvement rule

A candidate run is materially better when at least one of these is true:

| Signal | Required change |
| --- | --- |
| Download | at least 35% and 8 Mbps higher |
| Upload | at least 35% and 3 Mbps higher |
| Idle latency | at least 15 ms lower and no more than 75% of baseline |
| Jitter | at least 5 ms lower and no more than 65% of baseline |
| Worst loaded-latency rise | at least 20 ms lower and no more than 65% of baseline |
| Stability | at least 15 points higher |

These thresholds are diagnostic heuristics, not standards or service-level
guarantees. The exact values are implemented in
[`src/lib/diagnostics.ts`](src/lib/diagnostics.ts) and locked by deterministic
fixtures.

## Decision rules

| Assessment | Support rule | Important limitation |
| --- | --- | --- |
| Queueing under load | worst download/upload bufferbloat is at least 40 ms, run confidence at least 55%, and at least two loaded samples in each direction | establishes queueing, not queue ownership |
| Latency instability | idle jitter at least 15 ms and run confidence at least 55% | does not distinguish Wi-Fi, competing traffic, access link, or route |
| Local wireless path | confirmed Wi-Fi baseline plus a compatible near-router or Ethernet run with material improvement | cannot distinguish coverage from interference |
| VPN overhead | confirmed VPN-on baseline plus compatible VPN-off run with material improvement | does not identify encryption versus VPN-exit routing |
| Competing traffic | normal-traffic baseline plus compatible paused-traffic run with material improvement | other household conditions may also change |
| Device/browser | primary-device baseline plus compatible co-located other-device run with material improvement | does not identify the device subsystem |
| Temporary gateway state | compatible post-restart run materially improves | confidence capped at 60%; restart changes several variables |
| Time-of-day congestion | matched peak/off-peak pair materially improves off peak | confidence capped at 68%; repeat on another day and prefer Ethernet |
| Plan/modem/access/ISP candidate | explicitly entered plan plus at least two confident Ethernet runs across different device/time labels, all below 60% of plan | remains **possible**, not assigned to the ISP |

Missing paired evidence is shown as low-confidence **possible**, but it is not
promoted into the prioritized fix plan. A direct or paired possible finding must
have at least 35% diagnostic confidence to be prioritized.

## Deliberately unavailable diagnoses

- **True packet loss:** the experimental STUN signal is UDP reachability, not
  an end-to-end sent/received packet series.
- **DNS resolver performance:** browser fetch timing does not isolate recursive
  resolution, cache state, connection setup, and HTTPS transfer.
- **IPv4 versus IPv6:** the current browser endpoint cannot be forced to one IP
  family. NetPulse only records the observed provider-trace family.
- **Independent server/routing comparison:** production currently has one
  Cloudflare anycast provider.
- **Regional/provider outage:** a single browser on one access connection
  cannot establish outage scope or ownership.
- **Wi-Fi signal, band, channel, interference, router load, firmware health,
  modem signal, or connected devices:** these require native/router access or a
  cooperating service.

No simulated run, substitute value, or hidden fallback is produced for these
gaps.

## Guided workflows

The application supports real retests beside the router, in the original room,
over Ethernet, with a VPN disabled, with background traffic paused, on another
device, after a router/modem restart, and at peak/off-peak times. The user must
confirm the declared comparison condition before a run starts.

IPv4/IPv6 cards remain visible but unavailable. DNS and independent-server
requirements appear in evidence and guide text rather than as fake browser
tests.

## Purchase guidance

The default output is that no purchase is justified. A wired access point or
mesh system is mentioned only when a confirmed Wi-Fi baseline and repeated
near-router/Ethernet improvement support a local wireless-path gap. NetPulse
does not select a brand or model, and first recommends placement changes and a
retest. A plan upgrade is never recommended from a single throughput number.

## References

- [RFC 3393: IP Packet Delay Variation](https://www.rfc-editor.org/rfc/rfc3393)
- [RFC 7567: Active Queue Management recommendations](https://www.rfc-editor.org/rfc/rfc7567)
- [ICANN: The Domain Name System](https://www.icann.org/resources/pages/dns-2022-09-13-en)
- [Microsoft Support: Wi-Fi and your home layout](https://support.microsoft.com/en-us/windows/experience/connectivity-networking/wi-fi-and-your-home-layout)
