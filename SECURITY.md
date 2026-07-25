# Security policy

NetPulse welcomes responsible vulnerability reports. This policy is operational guidance, not a promise that the software or hosted service is free of vulnerabilities.

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability, exposed credential, privacy leak, or production abuse path. Use GitHub's private vulnerability reporting feature for `bbarc0de/netpulse` when available. If it is unavailable, contact the repository owner through the private contact method listed on the GitHub profile and ask for a secure reporting channel without including exploit details in the first message.

Include the affected version/URL, reproducible steps, impact, prerequisites, and a safe proof of concept. Remove personal data and credentials. NetPulse will acknowledge reports when operational capacity permits, triage severity, coordinate a fix and disclosure window, and credit reporters who request it and follow this policy.

## Safe-harbor expectations

Good-faith research must avoid privacy invasion, service disruption, bandwidth exhaustion, persistence, social engineering, credential attacks, accessing other users' data, or destructive testing. Stop after confirming the issue and report it privately. This is not legal advice or an authorization to violate third-party terms or law; qualified legal review is required before treating it as a final safe-harbor policy.

## Supported versions

Security fixes target the current `main` branch and current production deployment. Older forks and self-hosted deployments are maintained by their operators.

## Operator responsibilities

Self-hosters must protect secrets, enforce least-privilege database roles, apply security updates, configure rate/WAF controls, test backups, review logs, and comply with the AGPL-3.0-only license. See [SECURITY_AUDIT.md](SECURITY_AUDIT.md), [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md), and [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).

## Measurement-node security boundary

No public NetPulse measurement node is currently authorized or deployed.
Before a pilot, the node must implement the reviewed
[TEST_NODE_PROTOCOL.md](TEST_NODE_PROTOCOL.md) and pass:

- strict origin, version, session, duration, stream, byte, and body bounds;
- per-session and rotating per-address/coarse-prefix rate limits;
- overload admission that stops tests before capacity distorts results;
- no arbitrary fetch/proxy target, relay, reflection, broadcast, or file
  storage functionality;
- short-lived signed grants with keys unavailable to the browser;
- safe error responses without stack traces, credentials, private hosts, or
  internal topology;
- DDoS, malformed-input, session replay, CORS, IPv4/IPv6, drain, failover, and
  rollback tests;
- allowlisted logs that exclude payloads, full addresses in analytics, exact
  location, tokens, and cache nonces.

Bot challenges may be used only when risk justifies them and an accessible
fallback exists. Passing a challenge is not measurement evidence, and challenge
failure must not become a fake slow result.
