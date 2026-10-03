-- Sync documents (teams and matches), one row per account and document. A delete is a row with
-- deleted = 1 and no json (a tombstone), so it syncs like any other version.
CREATE TABLE IF NOT EXISTS documents (
  owner       TEXT    NOT NULL,                       -- the verified Cloudflare Access e-mail, lower case
  kind        TEXT    NOT NULL CHECK (kind IN ('team', 'match')),
  id          TEXT    NOT NULL,
  json        TEXT,                                   -- null for a tombstone
  updated_at  INTEGER NOT NULL,                       -- ms since the epoch, from the client's document
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  server_seq  INTEGER NOT NULL,                       -- per-account, ever-increasing: the sync cursor
  PRIMARY KEY (owner, kind, id)
);

CREATE INDEX IF NOT EXISTS documents_owner_seq ON documents (owner, server_seq);

-- Per-account sequence counter.
CREATE TABLE IF NOT EXISTS sync_seq (
  owner TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
