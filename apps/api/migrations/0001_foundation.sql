-- Foundation: tenancy, identity, sessions, audit (SP-004, SP-010, SP-011, SP-014)

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email            text NOT NULL CHECK (email = lower(email)),
  name             text NOT NULL,
  password_hash    text NOT NULL,
  role             text NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'operator', 'viewer')),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz
);
-- Email is globally unique so login does not need an organisation selector.
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE INDEX users_org_idx ON users (organization_id);

CREATE TABLE sessions (
  id               text PRIMARY KEY,               -- sha256(token), never the raw token
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  csrf_token       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  ip               text,
  user_agent       text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE audit_events (
  id               bigserial PRIMARY KEY,
  organization_id  uuid REFERENCES organizations (id) ON DELETE CASCADE,
  actor_user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text,
  request_id       text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_time_idx ON audit_events (organization_id, occurred_at DESC);
