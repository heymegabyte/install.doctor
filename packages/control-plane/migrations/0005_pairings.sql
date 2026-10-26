-- aid control plane: browser-first PAIRING (S04 one-link enrollment, MASTER-PROMPT §2). A headless
-- machine starts a pairing (short human `code` + a private poll-secret, only its SHA-256 stored); a
-- human APPROVES it in the browser (owner-authed); the machine POLLS with its poll-secret to CLAIM a
-- freshly-minted device token exactly once. No reusable credential is ever stored in plaintext or put
-- in a URL — the device token is minted at claim time and returned only in the poll-claim body.
CREATE TABLE IF NOT EXISTS pairings (
  code        TEXT PRIMARY KEY,         -- short human-typable code (also the browser lookup key)
  poll_sha256 TEXT NOT NULL UNIQUE,     -- SHA-256 of the machine's private poll-secret
  tenant      TEXT NOT NULL,
  label       TEXT,
  status      TEXT NOT NULL,            -- 'pending' | 'approved' | 'claimed'
  device_id   TEXT,                     -- set at claim
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,            -- short TTL (10 min)
  approved_at TEXT,
  claimed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_pairings_poll ON pairings(poll_sha256);
