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
