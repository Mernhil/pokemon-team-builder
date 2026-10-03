-- Sharing: folders (a top-level team and its variations) shared with another account, an opt-in
-- match-log share, and display names.

-- Which folder a team document lives in (its groupId, or its own id for a top-level team), so access
-- checks don't have to parse JSON. A tombstone keeps the folder of the version it replaced.
ALTER TABLE documents ADD COLUMN folder TEXT;
-- Who made the last version when it wasn't the owner (a shared-folder editor); null for the owner's own writes.
ALTER TABLE documents ADD COLUMN editor TEXT;
UPDATE documents SET folder = COALESCE(json_extract(json, '$.groupId'), id) WHERE kind = 'team' AND json IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_folder ON documents (owner, folder);

CREATE TABLE IF NOT EXISTS shares (
  owner      TEXT    NOT NULL,
  folder_id  TEXT    NOT NULL,                        -- the top-level team's id
  grantee    TEXT    NOT NULL,                        -- lower-case e-mail
  role       TEXT    NOT NULL CHECK (role IN ('view', 'edit')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, folder_id, grantee)
);
CREATE INDEX IF NOT EXISTS shares_grantee ON shares (grantee);

CREATE TABLE IF NOT EXISTS match_shares (
  owner      TEXT    NOT NULL,
  grantee    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, grantee)
);
CREATE INDEX IF NOT EXISTS match_shares_grantee ON match_shares (grantee);

CREATE TABLE IF NOT EXISTS profiles (
  email        TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);
