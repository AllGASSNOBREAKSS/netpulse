# NetPulse project policies

This file is the policy index for the current project. It does not promise
features NetPulse does not provide or replace qualified legal review.

## Accessibility

NetPulse aims to support keyboard navigation, visible focus indicators,
screen-reader labels, responsive layouts, sufficient color contrast, and the
operating system's reduced-motion preference. Accessibility problems are bugs;
please report them through the project's GitHub issue tracker with the browser,
operating system, assistive technology, and steps needed to reproduce the issue.

## Privacy

NetPulse is local-first and does not require an account. Test history,
diagnostic sessions, Connection Black Box sessions, and UI preferences are
stored in the browser. Black Box retention is user-selectable from 1 to 90
days, bounded to ten sessions and 5,000 latency samples per session. Diagnostic
sessions contain summarized measurements and user-confirmed comparison labels;
privacy-safe reports exclude full IP addresses, SSIDs, device names, browsing
history, and credentials. Speed and latency checks send HTTPS
requests to the selected public test provider, which necessarily sees the
requesting public IP address. NetPulse masks the public IP in its interface and
does not put it in saved history or exported results.

ISP, ASN, and approximate IP-based location data are requested only after the
user explicitly starts that lookup. The interface identifies the external
provider before the request. IP-based locations are approximate and must not be
treated as a precise physical location.

Black Box full JSON and CSV exports are explicit downloads and can include raw
probe timing, endpoint status, browser visibility, scheduling delay, and user
lag-marker timestamps. Safe share links put only a bounded summary in the URL
fragment, which is not sent to the hosting server by normal HTTP navigation;
they exclude raw samples, public IP, exact location, SSID, and device names.
Optional ISP/ASN/approximate-region metadata is included in a support report
only after a separate user opt-in.

See [PRIVACY.md](PRIVACY.md) for the full implementation-aligned privacy draft
and [ENGINE.md](ENGINE.md) for measurement and data-handling details.

## Terms of use

NetPulse provides informational browser-based network diagnostics. Measurements
vary with the device, browser, network load, route, and test endpoint. Results
are not a service-level guarantee, legal finding, or contractual assessment of
an internet provider.

The software is provided under the GNU Affero General Public License v3.0 only
and without warranty, as described in [LICENSE](LICENSE). The fuller terms and
acceptable-use drafts are [TERMS.md](TERMS.md) and
[ACCEPTABLE_USE.md](ACCEPTABLE_USE.md); both require qualified legal review.

## Security

Follow [SECURITY.md](SECURITY.md) for private vulnerability reporting. The
current threat model and unresolved operator controls are documented in
[SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## License and branding

Code is AGPL-3.0-only. See [NOTICE](NOTICE) and [TRADEMARKS.md](TRADEMARKS.md)
for attribution, branding, and non-affiliation language.

## Contact

For product questions, accessibility reports, and reproducible bugs, use the
[NetPulse issue tracker](https://github.com/bbarc0de/netpulse/issues/new/choose).
