-- Desktop Tools v1 device authorization. The target owns the polling secret and
-- private key; D1 stores only their public binding and the polling-secret digest.
CREATE TABLE IF NOT EXISTS device_authorizations (
  request_id TEXT PRIMARY KEY,
  verification_code TEXT NOT NULL UNIQUE,
  poll_sha256 TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_revision TEXT NOT NULL,
  profile_revision_digest TEXT NOT NULL,
  target_key_fingerprint TEXT NOT NULL,
  machine_label TEXT NOT NULL,
  requested_scopes TEXT NOT NULL,
  approved_scopes TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'expired', 'claimed')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  denied_at TEXT,
  cancelled_at TEXT,
  claimed_at TEXT,
  last_polled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_authorizations_poll ON device_authorizations(poll_sha256);

CREATE TABLE IF NOT EXISTS device_authorization_credentials (
  credential_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES device_authorizations(request_id),
  secret_sha256 TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  target_key_fingerprint TEXT NOT NULL,
  scopes TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

-- The credential insert and approved -> claimed transition are one SQLite
-- statement/trigger transaction, making concurrent claims and replay fail closed.
CREATE TRIGGER IF NOT EXISTS claim_device_authorization_after_credential_insert
AFTER INSERT ON device_authorization_credentials
BEGIN
  UPDATE device_authorizations
     SET status='claimed', claimed_at=NEW.issued_at
   WHERE request_id=NEW.request_id
     AND status='approved'
     AND expires_at>NEW.issued_at;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT, 'authorization claim unavailable') END;
END;
