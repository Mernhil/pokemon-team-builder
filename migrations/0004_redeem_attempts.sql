-- Throttle for POST /api/device/redeem (docs/SYNC.md): attempts per client and 10-minute bucket.
-- Only a hash of the client address is stored; old buckets are deleted as new ones start.
CREATE TABLE IF NOT EXISTS redeem_attempts (
  ip_hash TEXT    NOT NULL,           -- SHA-256 (hex) of the client address
  bucket  INTEGER NOT NULL,           -- floor(ms since the epoch / window)
  n       INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, bucket)
) WITHOUT ROWID;
