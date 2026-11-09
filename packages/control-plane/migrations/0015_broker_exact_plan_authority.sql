-- Exact privileged-plan facts admitted by a trusted server-side plan compiler. The device-facing
-- broker API cannot write this table: it can only reconstruct a plan already bound to the
-- authenticated device, immutable profile revision, active release, and run identifier.
CREATE TABLE broker_exact_plan_authority (
  run_id                    TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,
  profile_id                TEXT NOT NULL,
  profile_revision_digest   TEXT NOT NULL CHECK (length(profile_revision_digest) = 64),
  device_credential_id      TEXT NOT NULL,
  device_fingerprint        TEXT NOT NULL CHECK (length(device_fingerprint) = 64),
  release_id                TEXT NOT NULL,
  host_id                   TEXT NOT NULL,
  plan_digest               TEXT NOT NULL CHECK (length(plan_digest) = 64),
  enrolled_uid              INTEGER NOT NULL CHECK (enrolled_uid >= 0),
  broker_executable_digest  TEXT NOT NULL CHECK (length(broker_executable_digest) = 64),
  runtime_digest            TEXT NOT NULL CHECK (length(runtime_digest) = 64),
  worker_digest             TEXT NOT NULL CHECK (length(worker_digest) = 64),
  operations_json           TEXT NOT NULL CHECK (json_valid(operations_json)),
  descriptor_digest         TEXT NOT NULL CHECK (length(descriptor_digest) = 64),
  closure_digest            TEXT NOT NULL CHECK (length(closure_digest) = 64),
  consent_digest            TEXT NOT NULL CHECK (length(consent_digest) = 64),
  compiler_id               TEXT NOT NULL,
  compiler_digest           TEXT NOT NULL CHECK (length(compiler_digest) = 64),
  compiled_at               TEXT NOT NULL,
  expires_at                TEXT NOT NULL,
  UNIQUE (
    tenant_id, profile_id, profile_revision_digest, device_credential_id,
    device_fingerprint, release_id, run_id
  )
);

CREATE INDEX broker_exact_plan_bound_lookup
  ON broker_exact_plan_authority (
    tenant_id, profile_id, profile_revision_digest, device_credential_id,
    device_fingerprint, release_id, run_id
  );

CREATE TRIGGER broker_exact_plan_authority_no_update
BEFORE UPDATE ON broker_exact_plan_authority BEGIN
  SELECT RAISE(ABORT, 'broker exact plan authority is immutable');
END;

CREATE TRIGGER broker_exact_plan_authority_no_delete
BEFORE DELETE ON broker_exact_plan_authority BEGIN
  SELECT RAISE(ABORT, 'broker exact plan authority is immutable');
END;

