# Deployment (bare metal / VM)

StockPilot runs as one Node.js process for the API, static files for the web app served by
nginx, and a natively installed PostgreSQL. There are no images to build or ship and no hosted
services: everything below runs on one Linux VM (examples use Debian 12 / Ubuntu 24.04).
Background for these choices is in ADR-0019. Day-two operations are in [runbook.md](runbook.md).

```
 browser ──HTTPS──▶ nginx :443 ──┬── /            → /srv/stockpilot/current/apps/web/dist (static SPA)
                                 └── /api/        → http://127.0.0.1:4103 (stockpilot-api.service)
                                                         │
                                                         └── PostgreSQL 16 (Unix socket /var/run/postgresql)
```

## Single-instance constraint

The login and registration throttles keep their counters in API process memory
(`apps/api/src/http/rate-limiter.ts`, including the overflow sketch for evicted per-email lock-outs). Two API
processes would each enforce their own limits, which multiplies an attacker's budget, and a
restart forgets every counter. **Run exactly one API process.** Do not use Node cluster mode,
do not put several API processes or hosts behind nginx, and do not run blue/green API processes
side by side for longer than a switchover.

Before any multi-instance deployment, both of these tickets must be done:

- **SP-183**: security hardening (Postgres-backed throttles, ASVS L2 review);
- **SP-190**: Postgres-backed shared throttle store for multi-instance deployments.

Scale vertically until then. A single process handles the current workload: allocation and
ledger writes are bounded by row locks in PostgreSQL, not by API CPU.

## 1. Prepare the host

```bash
# Node.js 22 LTS from the distribution or NodeSource packages (no version manager on servers)
node -v            # must print v22.x or newer
sudo apt-get install -y postgresql-16 nginx

# Service account and directories
sudo useradd --system --home /srv/stockpilot --shell /usr/sbin/nologin stockpilot
sudo mkdir -p /srv/stockpilot/releases /etc/stockpilot /var/backups/stockpilot
sudo chown -R stockpilot:stockpilot /srv/stockpilot /var/backups/stockpilot
```

## 2. PostgreSQL

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE stockpilot LOGIN;                 -- peer auth over the Unix socket, no password
CREATE DATABASE stockpilot OWNER stockpilot;
SQL
```

- Connect over the local socket with peer authentication, so the OS user `stockpilot` maps to
  the role `stockpilot` and no password is stored anywhere:
  `DATABASE_URL=postgresql:///stockpilot?host=/var/run/postgresql`.
- Keep `listen_addresses = 'localhost'` (the default). Nothing outside the host needs the database.
- `pgcrypto` is not needed. `gen_random_uuid()` is built into PostgreSQL 13 and later.
- Size `max_connections` above `DATABASE_POOL_MAX` + 2 (the migration CLI) + admin sessions.

## 3. Secrets and configuration

Production settings live in `/etc/stockpilot/stockpilot.env`, owned by root, mode `0640`,
group `stockpilot`. Never put them in the repository or in the release directory.

```bash
sudo install -m 0640 -o root -g stockpilot /dev/null /etc/stockpilot/stockpilot.env
sudo tee /etc/stockpilot/stockpilot.env >/dev/null <<EOF
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=4103
APP_ORIGIN=https://wms.example.com
DATABASE_URL=postgresql:///stockpilot?host=/var/run/postgresql
DATABASE_POOL_MAX=20
SESSION_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
SESSION_TTL_HOURS=12
LOG_LEVEL=info
LOGIN_MAX_ATTEMPTS=5
LOGIN_WINDOW_MINUTES=15
LOGIN_BACKOFF_BASE_SECONDS=30
LOGIN_IP_MAX_ATTEMPTS=50
LOGIN_IP_MAX_EMAILS=20
REGISTER_IP_MAX_ATTEMPTS=10
# One nginx on this host appends the client address: trust exactly one hop.
TRUST_PROXY=1
EOF
```

- `TRUST_PROXY` **must** be present when `NODE_ENV=production`, otherwise the API refuses to
  start. Behind the single local nginx described here, use `1`. If nginx runs on another host,
  list its address or CIDR instead (`TRUST_PROXY=10.0.2.15`). Never put a CDN or a second proxy
  in front without updating this value. See [runbook.md](runbook.md#trust_proxy).
- `SESSION_SECRET` must be at least 32 characters and not the placeholder. Rotating it signs
  every user out (session ids are HMACs of the cookie token). It is also the HMAC key of the
  overflow sketch for evicted lock-outs, which is held only in memory anyway.
- Session cookies are marked `Secure` in production, so the site **must** be served over HTTPS.
- Logs go to the journal as JSON. Cookies and CSRF headers are redacted by the API.

## 4. Build a release

Releases are immutable directories `/srv/stockpilot/releases/<UTC timestamp>` with a `current`
symlink pointing at the live one.

```bash
sudo -u stockpilot -H bash -euo pipefail <<'SH'
REL=/srv/stockpilot/releases/$(date -u +%Y%m%d%H%M%S)
git clone --depth 1 --branch main https://github.com/mayur19/stockpilot.git "$REL"
cd "$REL"
npm ci --no-audit --no-fund        # full install: the build tools are dev dependencies
npm run typecheck
npm run build                      # apps/web/dist (static), apps/api/dist/{index.js,db/cli.js}
SH
```

The API build (`apps/api/tsup.config.ts`) bundles the workspace package `@stockpilot/shared`,
which ships TypeScript source, into `apps/api/dist`. Third-party dependencies (Fastify, pg, zod,
pino) stay external and load from the release's `node_modules`. At runtime the server needs
only `node`: it runs `dist/index.js` and `dist/db/cli.js` with the working directory set to
`<release>/apps/api`.

## 5. Migrate

Migrations are forward-only and run **before** the new API process starts. Each file runs in its
own transaction, so a failing migration leaves the database at the previous file. The CLI
reads `migrations/` relative to its working directory (`apps/api`); set `MIGRATIONS_DIR` to
run it from elsewhere.

```bash
cd /srv/stockpilot/releases/<new>/apps/api
sudo -u stockpilot node --env-file=/etc/stockpilot/stockpilot.env dist/db/cli.js migrate
```

Never run `db:reset` or `./run.sh reset` on a server; both refuse when `NODE_ENV=production`.
Do not run `db:seed` in production either, because it creates demo users with a published
password.

## 6. systemd unit for the API

`/etc/systemd/system/stockpilot-api.service`:

```ini
[Unit]
Description=StockPilot API
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=stockpilot
Group=stockpilot
WorkingDirectory=/srv/stockpilot/current/apps/api
# Node reads the root-owned, group-readable env file itself (mode 0640, group stockpilot).
ExecStart=/usr/bin/node --env-file=/etc/stockpilot/stockpilot.env dist/index.js
Restart=on-failure
RestartSec=3
# The API closes the server and the pool on SIGTERM.
KillSignal=SIGTERM
TimeoutStopSec=20

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=false
ReadWritePaths=/srv/stockpilot
CapabilityBoundingSet=
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stockpilot-api
journalctl -u stockpilot-api -f
curl -fsS http://127.0.0.1:4103/api/v1/ready
```

`MemoryDenyWriteExecute` stays `false` because V8's JIT needs writable executable memory.

## 7. nginx and TLS

`/etc/nginx/sites-available/stockpilot`:

```nginx
server {
    listen 80;
    server_name wms.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name wms.example.com;

    ssl_certificate     /etc/ssl/stockpilot/fullchain.pem;
    ssl_certificate_key /etc/ssl/stockpilot/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    root /srv/stockpilot/current/apps/web/dist;
    index index.html;

    # Static SPA: hashed assets are immutable, index.html is never cached.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }
    location / {
        add_header Cache-Control "no-store";
        add_header X-Content-Type-Options nosniff;
        add_header X-Frame-Options DENY;
        add_header Referrer-Policy no-referrer;
        try_files $uri /index.html;
    }

    # API: same origin, so SameSite=Lax cookies and the CSRF double submit just work.
    location /api/ {
        proxy_pass http://127.0.0.1:4103;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # Replace (not append) any client-supplied header; the API trusts exactly one hop.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id $request_id;
        proxy_read_timeout 30s;
        client_max_body_size 256k;     # matches the API body limit
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/stockpilot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

- **TLS:** use a certificate from your organisation's CA, or from an ACME client that runs on
  the host. Keep private keys at mode `0600`, owned by root. Renewal ends with
  `systemctl reload nginx`.
- `X-Forwarded-For $remote_addr` **overwrites** whatever the client sent, so the single trusted
  hop (`TRUST_PROXY=1`) always yields the real peer address for the per-IP throttles.
- `$request_id` gives every request a correlatable id across the nginx access log, the API logs
  and `audit_events.request_id`.

## 8. Release procedure

1. Build the new release directory (step 4). The live system is untouched.
2. Take a backup: `pg_dump --format=custom` (see [runbook.md](runbook.md#backup-and-restore)).
3. Run the migrations from the new release (step 5). Migrations must be backwards-compatible
   with the running code: add columns or tables, never drop or rename in the same release that
   stops using them.
4. Switch: `ln -sfn /srv/stockpilot/releases/<new> /srv/stockpilot/current && sudo systemctl restart stockpilot-api`.
   A restart takes a few seconds; nginx returns `502` meanwhile. Restarting also clears the
   in-memory auth throttles.
5. Smoke test: `/api/v1/ready` (check the migration count), sign in, load the stock screen, and
   run `GET /api/v1/inventory/projection/verify` as an owner, expecting `consistent: true`.
6. Keep the last 5 release directories and delete older ones.

## 9. Rollback

Migrations are **forward-only**: there are no down-migrations, and the runner rejects edited
files by checksum.

- **Code rollback (normal case):** point `current` back at the previous release and restart.
  This works because every migration is additive and backwards-compatible (rule 3 above).
- **Bad migration:** do not hand-edit `schema_migrations`. Write a new corrective migration and
  roll forward.
- **Data damage (last resort):** stop the API, restore the pre-release dump into a new database,
  point `DATABASE_URL` at it, start the previous release, and verify the projection. Any stock
  movements recorded after the backup are lost and must be re-entered from paper or scanner
  logs. This is why step 2 is mandatory.

## Backups

- A nightly `pg_dump --format=custom` to `/var/backups/stockpilot` from a systemd timer running as
  the `stockpilot` user, keeping 14 days, plus a copy moved off the host by your normal backup
  system.
- Optionally, for a recovery point under one day, enable WAL archiving
  (`archive_mode = on`, `archive_command` to a local or NFS directory) and take a weekly
  `pg_basebackup`.
- Restore drills: monthly and by hand until SP-182 automates them. A drill passes when
  `projection/verify` returns `consistent: true` on the restored copy.

## Monitoring checklist

- `GET /api/v1/ready` from your monitoring system (200 or 503).
- `journalctl -u stockpilot-api` for `level >= 50` (error) and for the warning
  `auth throttle store under pressure`.
- Disk space for PostgreSQL and the backup directory (the ledger only grows; partitioning is SP-186).
- Weekly `projection/verify`.
- A metrics endpoint is planned in SP-180.
