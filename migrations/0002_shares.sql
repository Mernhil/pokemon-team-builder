-- Sharing between two people. A team's "group" is its folder: its own id when it is the top-level
-- team, else its groupId. Sharing a folder shares the team and all of its variations.
ALTER TABLE documents ADD COLUMN group_id TEXT;
UPDATE documents SET group_id = COALESCE(json_extract(json, '$.groupId'), id) WHERE kind = 'team' AND json IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_owner_group ON documents (owner, group_id);

-- One row per thing shared with one person. kind 'team-group': ref is the folder's id.
-- kind 'matches': ref is '*' (the whole match log), view only.
CREATE TABLE IF NOT EXISTS shares (
  owner      TEXT    NOT NULL,
  grantee    TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('team-group', 'matches')),
  ref        TEXT    NOT NULL,
  role       TEXT    NOT NULL CHECK (role IN ('view', 'edit')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, grantee, kind, ref)
);
CREATE INDEX IF NOT EXISTS shares_grantee ON shares (grantee);

-- A name to show instead of an e-mail address.
CREATE TABLE IF NOT EXISTS profiles (
  email        TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);
