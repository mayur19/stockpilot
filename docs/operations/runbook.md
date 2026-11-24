# Operations runbook

This runbook covers configuration, day-to-day commands, backup and restore, ledger verification
and troubleshooting. For installing on a server, see [deployment.md](deployment.md).

## Configuration

The API reads its environment through a zod schema (`apps/api/src/config/env.ts`) and **refuses
to start** on invalid values, printing every issue as `Invalid configuration: KEY: message; ...`.
In development `run.sh` creates `.env` from `.env.example` (mode 600) and replaces the
placeholder secret with 32 random bytes in hex. The npm scripts load `.env` through
`node --env-file-if-exists`.

| Variable                     | Default                                  | Read by          | Meaning                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                   | `development`                            | API, CLI         | `development`, `test` or `production`. In production, cookies get `Secure`, the placeholder `SESSION_SECRET` is refused, `TRUST_PROXY` must be set explicitly, and `db:reset` / `./run.sh reset` refuse to run.  |
| `API_HOST`                   | `127.0.0.1`                              | API, Vite proxy  | Listen address. Keep it on loopback behind nginx.                                                                                                                                                                |
| `API_PORT`                   | `4103`                                   | API, Vite proxy  | Listen port.                                                                                                                                                                                                     |
| `WEB_PORT`                   | `5103`                                   | Vite, Playwright | Dev server port (`strictPort`, so it fails rather than moving to another port).                                                                                                                                  |
| `APP_ORIGIN`                 | `http://localhost:5103`                  | API (validated)  | Public origin of the web app. It must be a URL. At present it is informational (the API serves same-origin only and sends no CORS headers); `run.sh` prints it.                                                  |
| `DATABASE_URL`               | — (required)                             | API, CLI         | PostgreSQL URL. In development: `postgresql://localhost:5432/stockpilot_dev?host=/tmp` (Unix socket, current OS user, no password). The database name may only contain `[A-Za-z0-9_]` for `run.sh` to create it. |
| `TEST_DATABASE_URL`          | derived `<db>_test`                      | Vitest, run.sh   | Disposable database for integration tests. **Its `public` schema is dropped on every test run.** Never point it at real data.                                                                                    |
| `DATABASE_POOL_MAX`          | `10`                                     | API              | Max pool connections (1-100). Each allocation or ledger write holds one connection for the whole transaction.                                                                                                    |
| `SESSION_SECRET`             | — (required, >= 32 chars)                | API              | HMAC key that turns session tokens into stored session ids. Rotating it signs **everyone** out.                                                                                                                  |
| `SESSION_TTL_HOURS`          | `12`                                     | API              | Absolute session lifetime (1-720). Activity does not extend it.                                                                                                                                                  |
| `LOG_LEVEL`                  | `info`                                   | API, CLI         | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Pino JSON logs; the `cookie`, `x-csrf-token` and `set-cookie` headers are redacted.                                                              |
| `LOGIN_MAX_ATTEMPTS`         | `5`                                      | API              | Failures per email before the backoff starts.                                                                                                                                                                    |
| `LOGIN_WINDOW_MINUTES`       | `15`                                     | API              | Window for the per-IP limiters. Also the cap on the per-email backoff; per-email failures decay after 4 windows.                                                                                                 |
| `LOGIN_BACKOFF_BASE_SECONDS` | `30`                                     | API              | First lock-out once the backoff starts; it doubles with each further failure, up to the window.                                                                                                                  |
| `LOGIN_IP_MAX_ATTEMPTS`      | `50`                                     | API              | Failed logins from one client IP across all emails per window (password-spraying guard).                                                                                                                         |
| `LOGIN_IP_MAX_EMAILS`        | `20`                                     | API              | Distinct emails one client IP may try per window. IPv6 clients are keyed by their /64 prefix (IPv4-mapped IPv6 by the IPv4 address); a whole IPv6 /48 may try 4x this many.                                      |
| `REGISTER_IP_MAX_ATTEMPTS`   | `10`                                     | API              | Registrations per client IP per hour.                                                                                                                                                                            |
| `TRUST_PROXY`                | `false` (must be explicit in production) | API              | Which peers may set `X-Forwarded-For`. See below.                                                                                                                                                                |
| `MIGRATIONS_DIR`             | `<cwd>/migrations`                       | CLI              | Optional override for the migrations folder (the npm scripts run in `apps/api`, so the default resolves to `apps/api/migrations`).                                                                               |

### `TRUST_PROXY`

`request.ip` feeds every per-IP throttle, so it must not be spoofable.

| Value                      | Effect                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `false` (or empty)         | `X-Forwarded-For` is ignored; the client is the TCP peer. Correct when clients connect directly (development).           |
| `1` (a hop count `0`-`99`) | Trust the nearest N proxies. With a single nginx on the same host use `1`: the client is the address nginx appended.     |
| `10.0.0.5,10.0.1.0/24`     | Trust only these proxy IPs or CIDRs (IPv4 or IPv6), for proxies on other hosts.                                          |
| `true`                     | **Rejected at startup**, because trusting every hop would let any client choose its own IP and bypass the per-IP limits. |

With `NODE_ENV=production`, leaving `TRUST_PROXY` unset stops the API at startup
(`TRUST_PROXY must be set explicitly in production`). This forces a deliberate choice. Behind
nginx, a wrong `false` makes every user share nginx's IP, so a single spraying source throttles
everyone.

### Auth throttles in memory

The limiters live in the API process (`apps/api/src/http/rate-limiter.ts`):

- The precise caches are authoritative and each is capped at 100 000 keys. When a cache is
  full, expired entries are swept first. If all are still active, the entry with the least time
  left is evicted and the API logs `warn` `auth throttle store under pressure` with
  `{ event: "throttle_store_full", store, capacity, evictedMsLeft }`. New keys are never refused.
- An evicted per-email entry that is still active is absorbed into a fixed-size count-min sketch
  (4 x 16 384 cells, about 1 MiB, ADR-0020). Its cells are keyed by HMAC(`SESSION_SECRET`,
  email), and it is read only for emails without a precise entry, so the lock-out survives the
  eviction. Ordinary failures never touch the sketch, and a successful login always clears the
  lock-out. Absorbed failures decay after two rotation periods of 4 login windows each.
- Saturation guard: if any sketch row is more than 50% occupied, the sketch is ignored for reads
  and `stats().saturatedReads` increments. Each such read logs the warning
  `auth throttle store under pressure` with
  `{ event: "throttle_sketch_saturated", occupancy, saturatedReads }`. Treat it as an active
  attack signal.
- A restart clears every counter, the sketch included.
- Counters are **per process**. Run exactly one API instance until SP-183 (hardening) and
  SP-190 (shared throttle store in PostgreSQL) land (see [deployment.md](deployment.md#single-instance-constraint)).

## Everyday commands (`run.sh`)

| Command                     | What it does                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./run.sh` / `./run.sh dev` | Checks prerequisites (Node >= 22, npm, `psql`), creates `.env`, runs `npm ci` when the lockfile changed, creates the database, migrates, seeds if there are no users, then starts the API (4103) and web (5103) together. |
| `./run.sh setup`            | Everything `dev` does, without starting the servers.                                                                                                                                                                      |
| `./run.sh migrate`          | Applies pending migrations (`npm run db:migrate`).                                                                                                                                                                        |
| `./run.sh seed`             | Loads the demo organisation. It is idempotent: it skips if `owner@stockpilot.test` exists.                                                                                                                                |
| `./run.sh reset [--yes]`    | **Destroys data**: `DROP SCHEMA public CASCADE`, then migrate and seed. It asks first unless `--yes` is given and refuses when `NODE_ENV=production`.                                                                     |
| `./run.sh test`             | Creates `<db>_test` if needed and runs all workspace tests against it.                                                                                                                                                    |
| `./run.sh e2e`              | Setup, then Playwright (installs Chromium if possible).                                                                                                                                                                   |
| `./run.sh check`            | Lint, format check, typecheck, tests (what CI runs, minus the build).                                                                                                                                                     |
| `./run.sh build`            | Production build: `apps/api/dist` (tsup) and `apps/web/dist` (Vite).                                                                                                                                                      |

Demo users (development only): `owner@`, `manager@`, `operator@` and `viewer@stockpilot.test`,
all with the password `stockpilot-demo-2026`.

### Migrations

- These are plain SQL files `apps/api/migrations/NNNN_description.sql`, applied in lexical
  order, each inside its own transaction, and recorded in `schema_migrations(name, checksum, applied_at)`.
- Migrations are **forward-only**. Never edit an applied file: the runner compares SHA-256
  checksums and stops. Fix mistakes with a new migration.
- Check what is applied with `psql "$DATABASE_URL" -c 'TABLE schema_migrations'`, or with
  `/api/v1/ready`, which returns the count.

## Backup and restore

The ledger (`inventory_movements`) is the source of truth, and everything else in the stock
domain can be checked against it. Back up the whole database, consistently, in one dump.

```bash
# Logical backup, custom format (compressed, parallel-restorable, consistent snapshot)
pg_dump --format=custom --no-owner --file="stockpilot-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"

# Inspect a dump
pg_restore --list stockpilot-20261125T020000Z.dump | head

# Restore into a NEW, empty database (never over the live one)
createdb stockpilot_restore
pg_restore --no-owner --exit-on-error --jobs=4 --dbname=postgresql://localhost:5432/stockpilot_restore?host=/tmp \
  stockpilot-20261125T020000Z.dump

# Verify, then switch: stop the API, point DATABASE_URL at the restored database, start the API.
```

After any restore:

1. Run `/api/v1/ready` and check that the migration count matches the release.
2. As an owner or admin, call `GET /api/v1/inventory/projection/verify` (see below) and expect
   `consistent: true`.
3. Spot-check `GET /api/v1/inventory/movements?warehouseId=...&limit=5` to confirm the newest
   movement is the one you expect.

Recommended schedule for a VM install: a nightly `pg_dump` from a systemd timer, 14 days kept
on disk, and a copy held off the host (see [deployment.md](deployment.md#backups)). A scripted
restore drill is ticket SP-182. Until it lands, do the drill by hand once a month.

## Projection verification

`stock_balances` is a projection, updated in the same transaction as each ledger append. To
check that it still equals a full replay of the ledger:

```bash
curl -s -b owner.jar http://127.0.0.1:4103/api/v1/inventory/projection/verify
# {"data":{"consistent":true,"movementCount":13,"balanceCount":11,"mismatches":[]},"error":null}
```

- This needs `inventory:verify` (owner or admin) and checks the whole organisation.
- It is read-only. It loads the entire ledger into memory and folds it with the shared
  `projectBalances`, so for a large ledger run it off-peak. Snapshots (SP-044) will bound this cost.
- Run it after every restore, after any manual SQL against stock tables, after an incident
  involving `500`s on ledger writes, and on a schedule (weekly is enough at current volumes).

## Troubleshooting

| Symptom                                                                                             | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cannot reach PostgreSQL via postgresql://localhost:5432/postgres?host=/tmp`                        | The server is not running, or its socket is not in `/tmp`. Start it (`brew services start postgresql@16`, `sudo systemctl start postgresql`). Debian/Ubuntu packages put the socket in `/var/run/postgresql`: change `host=` in `DATABASE_URL`, or run `psql -h /tmp` to confirm where it is. `ls -la /tmp/.s.PGSQL.5432` should exist.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `role "<you>" does not exist`                                                                       | Peer/trust login uses your OS user name. Create it: `sudo -u postgres createuser --createdb "$USER"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `EADDRINUSE 127.0.0.1:4103` or Vite `Port 5103 is already in use`                                   | An old instance is still running. Find it with `lsof -nP -iTCP:4103 -sTCP:LISTEN` (or `:5103`) and stop it, or change `API_PORT` / `WEB_PORT` in `.env`. Vite uses `strictPort`, so it will not pick another port by itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Migration 0002_topology_catalog.sql was modified after being applied; add a new migration instead` | An applied file changed (an edit, a line-ending change, or a git checkout of another branch). Restore the file exactly (`git checkout -- apps/api/migrations/`). In **development only**, `./run.sh reset` rebuilds from scratch. In production, never update `schema_migrations.checksum` by hand: ship a new migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Invalid configuration: TRUST_PROXY must be set explicitly in production`                           | Set `TRUST_PROXY=1` behind a local nginx (or the proxy CIDRs), or `false` if clients connect directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Invalid configuration: SESSION_SECRET ...`                                                         | Missing, shorter than 32 characters, or still the placeholder in production. Create one: `node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Many `429 RATE_LIMITED` on login                                                                    | Check `details.retryAfterSeconds`. **Everyone** throttled at once behind a proxy means `TRUST_PROXY` is wrong, so all users share the proxy IP: set it to `1` or the proxy CIDR. One account locked means per-email backoff after `LOGIN_MAX_ATTEMPTS` failures; wait, or restart the API to clear all counters (a restart clears them for everyone). An office behind one NAT may hit `LOGIN_IP_MAX_ATTEMPTS` / `LOGIN_IP_MAX_EMAILS`, so raise them. A warning `auth throttle store under pressure` means a store is full, which is typically an attack: check logs for the source.                                                                                                                                                                                          |
| `409 INSUFFICIENT_STOCK` on allocation                                                              | Not enough **eligible** stock, as `details.lines[]` shows (`shortfall`, `excluded`). Usual reasons: stock is in RECEIVING or QUARANTINE zones (only STORAGE and PICK are allocatable, so move it), lots are expired or inside `minShelfLifeDays`, lots are on hold, units are already allocated (compare `allocated` in `/inventory/balances`), or `shipComplete=true` with any line short. Use partial allocation or release stale allocations.                                                                                                                                                                                                                                                                                                                               |
| `409 INSUFFICIENT_AVAILABLE` on a move or negative adjustment                                       | Units are reserved by an allocation. Release the allocation first, or move only `available`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `409 ALREADY_EXISTS` on allocation                                                                  | A live (non-released) allocation already exists for that `orderRef` in the warehouse. Release it or use a new reference.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `503 CONCURRENCY_RETRY`                                                                             | A deadlock or serialization failure, rolled back. Retrying is safe. If it is frequent, look for manual SQL or long transactions holding `stock_balances` locks (`SELECT * FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE NOT granted;`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/ready` returns `503 NOT_READY`                                                                    | Database down, credentials wrong, or migrations never applied. Run `./run.sh migrate`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Verify returns `consistent: false`                                                                  | The projection drifted from the ledger. **Do not edit the ledger** (the trigger blocks UPDATE/DELETE anyway). Steps: (1) stop writes (stop the API); (2) save the `mismatches` output and a `pg_dump`; (3) find the cause, usually manual SQL on `stock_balances` or a restore from mismatched dumps, and check `last_movement_id`/`updated_at` on the affected rows; (4) correct the projection from the ledger. The ledger's `expected` values are authoritative, so set each mismatched row's `on_hand`/`allocated` to `expected` in one transaction. If the physical count disagrees with the ledger, post adjustments (`/inventory/adjustments`, reason `CORRECTION`) so the fix is itself recorded; (5) re-run verify until it returns `consistent: true`, then restart. |
| `inventory_movements is append-only (UPDATE rejected)`                                              | Someone tried to edit the ledger. This is by design: post a compensating movement instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Users are logged out after a deploy                                                                 | `SESSION_SECRET` changed, or the session row expired (`SESSION_TTL_HOURS`). Expected after a secret rotation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
