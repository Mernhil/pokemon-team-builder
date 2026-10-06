-- Linking a desktop app (docs/SYNC.md "Linking the desktop app"). Only hashes are stored: a pairing
-- code is single-use and short-lived, a device token is shown to the device once.
CREATE TABLE IF NOT EXISTS pair_codes (
  code_hash  TEXT    PRIMARY KEY,        -- SHA-256 (hex) of the normalised code
  owner      TEXT    NOT NULL,           -- the Access e-mail that created it
  expires_at INTEGER NOT NULL            -- ms since the epoch
);
CREATE INDEX IF NOT EXISTS pair_codes_owner ON pair_codes (owner);

CREATE TABLE IF NOT EXISTS devices (
  id           TEXT    PRIMARY KEY,      -- random, shown in the device list
  owner        TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,  -- SHA-256 (hex) of the bearer token
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_owner ON devices (owner);
