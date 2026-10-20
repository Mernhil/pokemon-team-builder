-- The friend list (docs/ACCOUNTS_PLAN.md section 10.2): request → accept, a single-use friend code, blocks.
-- Sharing between two accounts needs an accepted friendship (worker/api.ts). Additive.
CREATE TABLE IF NOT EXISTS friendships (
  a            TEXT    NOT NULL,              -- user ids, a < b: one row per pair
  b            TEXT    NOT NULL,
  state        TEXT    NOT NULL CHECK (state IN ('pending', 'accepted')),
  requested_by TEXT    NOT NULL,              -- a or b
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (a, b),
  CHECK (a < b)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS friendships_b ON friendships (b);

CREATE TABLE IF NOT EXISTS blocks (
  blocker    TEXT    NOT NULL,
  blocked    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker, blocked)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks (blocked);

-- A friend code someone sends over any chat: whoever enters it becomes their friend at once. Only the hash is kept.
CREATE TABLE IF NOT EXISTS friend_links (
  code_hash  TEXT    PRIMARY KEY,
  owner      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by    TEXT,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS friend_links_owner ON friend_links (owner);

-- Accounts that already share with each other (shares made before friends existed) are friends.
INSERT OR IGNORE INTO friendships (a, b, state, requested_by, created_at, updated_at)
SELECT MIN(owner, grantee), MAX(owner, grantee), 'accepted', owner, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM shares WHERE owner LIKE 'u\_%' ESCAPE '\' AND grantee LIKE 'u\_%' ESCAPE '\' AND owner <> grantee;
