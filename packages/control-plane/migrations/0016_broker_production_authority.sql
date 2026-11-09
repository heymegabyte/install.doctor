-- Production authority for privileged Desktop Tools broker runs.
--
-- Existing device rows remain readable by compatibility APIs, but cannot authorize a privileged
-- run until an authenticated enrollment flow binds them to an exact public profile revision.
ALTER TABLE devices ADD COLUMN profile_id TEXT;
ALTER TABLE devices ADD COLUMN profile_revision_digest TEXT
  CHECK (profile_revision_digest IS NULL OR length(profile_revision_digest) = 64);

-- Tenant ownership is server-managed state. It must never be inferred from a tenant string,
-- pairing request, device claim, email allowlist, or caller-supplied owner_actor value.
CREATE TABLE tenant_owner_authority (
  authority_id          TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  owner_actor_id        TEXT NOT NULL,
  better_auth_user_id   TEXT NOT NULL,
  authentication_actor TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at            TEXT NOT NULL,
  revoked_at            TEXT,
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX tenant_owner_authority_active_tenant
  ON tenant_owner_authority (tenant_id)
  WHERE status = 'active';
CREATE INDEX tenant_owner_authority_user
  ON tenant_owner_authority (better_auth_user_id, status);
