-- aid control plane: enrolled devices (Phase B / S04 device identity, S27 per-device revocation).
-- A device presents an opaque bearer token; only its SHA-256 is stored, so a DB read can never reveal
-- the secret. Revocation is a row update (revoked_at set) — instant, no blocklist, no signing key.
-- See docs/aid/decisions/0002-device-token-hashed-opaque-over-jwt.md.
CREATE TABLE IF NOT EXISTS devices (
  device_id    TEXT PRIMARY KEY,
  tenant       TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token_sha256);
CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant);
