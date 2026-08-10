# Security Policy

English | [简体中文](SECURITY.md)

## Supported versions

Security fixes target the latest stable release and the `main` branch. Older versions may need to be upgraded before an issue can be confirmed.

## Reporting a vulnerability privately

Prefer GitHub's **Security → Report a vulnerability** private reporting feature. Do not post exploit code, proxy credentials, tokens, private keys, real private-network addresses, or logs containing personal information in a public issue.

Include the affected version and platform, reproduction steps, impact, minimized logs, and any suggested mitigation. If private vulnerability reporting is not enabled, open a public issue without sensitive details and ask the maintainer for a private contact channel.

## Important boundaries

- Haruha changes the current user's operating-system proxy settings.
- The PAC server binds only to `127.0.0.1` and must not be exposed to the LAN.
- Configuration and logs are stored in the local user configuration directory and must not be committed.
- IP lookup, speed testing, and favicon retrieval contact third-party services; do not place sensitive URLs in speed-test configuration.
- A forced exit may leave proxy settings active; disable them in the operating-system settings if networking fails.

See the [architecture document](docs/en/architecture.md#security-model) for technical boundaries.
