# ADR-0019: Native PostgreSQL and systemd deployment, no containers

- **Status:** Accepted
- **Date:** 2026-11
- **Tickets:** SP-005, SP-006; follow-ups SP-180, SP-182, SP-183

## Context and problem statement

StockPilot targets small and mid-size warehouses that often run on a single VM or a server in the site office, sometimes with intermittent internet. Operators may not have container expertise or a registry. CI must also exercise a real PostgreSQL. How should the system be packaged, deployed and tested?

## Decision drivers

- Minimum moving parts for a one-host installation.
- Use OS-native process supervision, logging and package updates.
- CI identical in spirit to production: a real, natively installed PostgreSQL.
- Reproducible local development with `run.sh`.

## Considered options

1. Native services managed by systemd: Node.js API process, nginx, PostgreSQL from the OS packages; CI uses the PostgreSQL that ships on the GitHub `ubuntu-latest` runner.
2. Container runtime with compose files.
3. Kubernetes.
4. Platform-as-a-service.

## Decision outcome

Chosen option: **1**.

- **Production:** `stockpilot-api.service` runs `node apps/api/dist/index.js` as an unprivileged `stockpilot` user with `EnvironmentFile=/etc/stockpilot/env`, `Restart=on-failure` and systemd hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`). nginx terminates TLS, serves `apps/web/dist`, and proxies `/api/` to `127.0.0.1:4103`; the API sets `TRUST_PROXY=1`. PostgreSQL is the distribution package; the API connects over the local Unix socket. Logs go to journald. A systemd timer runs nightly `pg_dump -Fc` (SP-182 automates restore drills).
- **CI:** `.github/workflows/ci.yml` runs `sudo systemctl start postgresql.service`, creates a role and database with `sudo -u postgres psql`, then lint, format check, typecheck, coverage tests against `TEST_DATABASE_URL`, build, and a `db:reset` smoke test. No service containers.
- **Local:** `run.sh setup` checks prerequisites (Node 22, `psql`), bootstraps `.env` with a random `SESSION_SECRET`, creates databases on the local socket in `/tmp` as the current OS user, migrates and seeds.

### Consequences

- Good: an operator needs only standard Linux skills; the whole stack is three services and one timer.
- Good: CI tests the exact SQL features production relies on (triggers, partial indexes, `FOR UPDATE OF`).
- Good: single-host shape matches the in-memory throttle design today.
- Bad: no immutable artefact; releases are a built directory plus `package-lock.json`. Reproducibility depends on `npm ci` and a pinned Node version (`.nvmrc`).
- Bad: horizontal scaling requires SP-183 and SP-190 (Postgres-backed shared throttle store) and a second host behind nginx; high availability of PostgreSQL (streaming replica) is a documented manual option, not automated.
