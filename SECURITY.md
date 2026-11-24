# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
"Report a vulnerability" (security advisories) on this repository rather than opening a
public issue. Include reproduction steps and the affected version or commit. You should
receive an acknowledgement within five working days.

## Supported versions

Only the latest `main` is supported while the project is pre-1.0.

## Security model in brief

- Passwords hashed with scrypt (N=2^15, r=8, p=1); sessions stored as HMAC digests in
  PostgreSQL; HttpOnly SameSite=Lax session cookie, `Secure` in production.
- CSRF double-submit token required on every mutating authenticated request.
- Permission checks on every route (RBAC); every query scoped by organisation.
- Login throttling per email (progressive backoff) and per IP (password spraying), with
  attempts reserved before any I/O so concurrent bursts cannot bypass the limits; a cap on
  distinct emails per client IP (IPv6 reduced to /64); per-IP registration limits.
  Registration never reveals whether an email exists.
- `TRUST_PROXY` defaults to `false` and must be set explicitly in production; set a hop count or proxy CIDRs only when running behind
  a known reverse proxy. The throttle counters are in-process and must move to PostgreSQL
  (SP-183) before running more than one API instance.
- The application makes no outbound network calls.

See [docs/security/threat-model.md](docs/security/threat-model.md) for the full threat model.
