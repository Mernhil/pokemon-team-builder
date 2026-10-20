-- "Bring my teams from before" (docs/ACCOUNTS_PLAN.md section 9): an account takes over the data its owner synced
-- with a Cloudflare Access e-mail. Additive. account_claims is the audit and the way back (npm run admin -- unclaim).
CREATE TABLE IF NOT EXISTS account_claims (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL,
  legacy_email TEXT    NOT NULL,
  at           INTEGER NOT NULL,
  docs         INTEGER NOT NULL,   -- teams moved
  matches      INTEGER NOT NULL,   -- matches moved
  shares       INTEGER NOT NULL,   -- shares, either way round
  devices      INTEGER NOT NULL,   -- linked desktop apps
  undone_at    INTEGER             -- set by unclaim
);
CREATE INDEX IF NOT EXISTS account_claims_user ON account_claims (user_id);

-- Whether a new account has decided: 'pending' (the app offers to bring the old data; syncing waits),
-- 'claimed' or 'skipped'.
ALTER TABLE users ADD COLUMN claim_state TEXT NOT NULL DEFAULT 'pending' CHECK (claim_state IN ('pending', 'claimed', 'skipped'));
