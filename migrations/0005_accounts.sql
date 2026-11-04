-- The app's own accounts (docs/ACCOUNTS_PLAN.md). Additive: nothing here is read until AUTH_MODE is "both".
-- Secrets are never stored: passwords are peppered PBKDF2 hashes; session tokens, invites, recovery and
-- reset codes are SHA-256 hashes of long random values.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT    PRIMARY KEY,                 -- "u_" + random; what documents.owner holds after a claim
  username      TEXT    NOT NULL,                    -- as typed, shown
  username_key  TEXT    NOT NULL UNIQUE,             -- lower case: names are unique case-insensitively
  display_name  TEXT,
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  disabled      INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  pw_hash       TEXT    NOT NULL,                    -- pbkdf2-sha256$i=…$p=…$salt$hash
  pw_changed_at INTEGER NOT NULL,
  recovery_hash TEXT    NOT NULL,                    -- SHA-256 (hex) of the recovery code
  legacy_email  TEXT    UNIQUE,                      -- the Cloudflare Access e-mail this account claimed (docs/ACCOUNTS_PLAN.md section 9)
  invited_by    TEXT,
  created_at    INTEGER NOT NULL
);

-- One row per logged-in device (web, phone app, desktop app).
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT    PRIMARY KEY,                  -- random, shown in the device list
  user_id      TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('web', 'desktop')),
  token_hash   TEXT    NOT NULL UNIQUE,              -- SHA-256 (hex) of the token
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  renewed_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS invites (
  code_hash  TEXT    PRIMARY KEY,
  created_by TEXT    NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by    TEXT,
  used_at    INTEGER,
  revoked_at INTEGER
);

-- A password reset an admin made for a user (the recovery code lives on the user).
CREATE TABLE IF NOT EXISTS reset_codes (
  code_hash  TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  created_by TEXT    NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reset_codes_user ON reset_codes (user_id);

-- Throttle counters: attempts per scope, hashed client/username and time bucket. Old buckets are deleted as new ones start.
CREATE TABLE IF NOT EXISTS throttles (
  scope    TEXT    NOT NULL,
  key_hash TEXT    NOT NULL,
  bucket   INTEGER NOT NULL,
  n        INTEGER NOT NULL,
  PRIMARY KEY (scope, key_hash, bucket)
) WITHOUT ROWID;

-- Admin audit trail. No secrets.
CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     INTEGER NOT NULL,
  actor  TEXT    NOT NULL,
  kind   TEXT    NOT NULL,
  target TEXT
);

-- Reserved for passkeys (a later version); unused in v1.
CREATE TABLE IF NOT EXISTS credentials (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  public_key TEXT    NOT NULL,
  counter    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credentials_user ON credentials (user_id);
