-- Source facts from which the broker approval service reconstructs a grant. A run intent is
-- immutable exact-plan state, not a serialized caller-authored grant.
CREATE TABLE broker_run_intents (
  run_intent_id            TEXT PRIMARY KEY,
  authorization_id         TEXT NOT NULL UNIQUE,
  tenant_id                TEXT NOT NULL,
  profile_id               TEXT NOT NULL,
  profile_revision_digest  TEXT NOT NULL CHECK (length(profile_revision_digest) = 64),
  device_credential_id     TEXT NOT NULL,
  device_fingerprint       TEXT NOT NULL CHECK (length(device_fingerprint) = 64),
  grant_id                 TEXT NOT NULL UNIQUE,
  host_id                  TEXT NOT NULL,
  release_id               TEXT NOT NULL,
  run_id                   TEXT NOT NULL UNIQUE,
  plan_digest              TEXT NOT NULL CHECK (length(plan_digest) = 64),
  enrolled_uid             INTEGER NOT NULL CHECK (enrolled_uid >= 0),
  broker_executable_digest TEXT NOT NULL CHECK (length(broker_executable_digest) = 64),
  runtime_digest           TEXT NOT NULL CHECK (length(runtime_digest) = 64),
  worker_digest            TEXT NOT NULL CHECK (length(worker_digest) = 64),
  operations_json          TEXT NOT NULL CHECK (json_valid(operations_json)),
  descriptor_digest        TEXT NOT NULL CHECK (length(descriptor_digest) = 64),
  closure_digest           TEXT NOT NULL CHECK (length(closure_digest) = 64),
  consent_digest           TEXT NOT NULL CHECK (length(consent_digest) = 64),
  requested_at             TEXT NOT NULL,
  grant_expires_at         TEXT NOT NULL,
  recorded_at              TEXT NOT NULL,
  UNIQUE (
    authorization_id, tenant_id, profile_id, profile_revision_digest,
    device_credential_id, device_fingerprint, run_intent_id, grant_id,
    run_id, plan_digest, consent_digest
  ),
  UNIQUE (
    authorization_id, tenant_id, profile_id, profile_revision_digest,
    device_credential_id, device_fingerprint, run_intent_id,
    plan_digest, consent_digest
  )
);

-- One terminal authenticated owner decision per run intent. Reapproval requires a new run intent
-- so a previous denial or expired consent can never be reinterpreted as authority.
CREATE TABLE broker_owner_decisions (
  owner_decision_id        TEXT PRIMARY KEY,
  run_intent_id            TEXT NOT NULL UNIQUE REFERENCES broker_run_intents(run_intent_id),
  authorization_id         TEXT NOT NULL UNIQUE,
  tenant_id                TEXT NOT NULL,
  profile_id               TEXT NOT NULL,
  profile_revision_digest  TEXT NOT NULL CHECK (length(profile_revision_digest) = 64),
  device_credential_id     TEXT NOT NULL,
  device_fingerprint       TEXT NOT NULL CHECK (length(device_fingerprint) = 64),
  approved_plan_digest     TEXT NOT NULL CHECK (length(approved_plan_digest) = 64),
  consent_digest           TEXT NOT NULL CHECK (length(consent_digest) = 64),
  owner_actor_id           TEXT NOT NULL,
  decision                 TEXT NOT NULL CHECK (decision IN ('approved', 'denied')),
  owner_reauthenticated_at TEXT NOT NULL,
  decided_at               TEXT NOT NULL,
  expires_at               TEXT NOT NULL,
  recorded_at              TEXT NOT NULL,
  FOREIGN KEY (
    authorization_id, tenant_id, profile_id, profile_revision_digest,
    device_credential_id, device_fingerprint, run_intent_id,
    approved_plan_digest, consent_digest
  ) REFERENCES broker_run_intents (
    authorization_id, tenant_id, profile_id, profile_revision_digest,
    device_credential_id, device_fingerprint, run_intent_id,
    plan_digest, consent_digest
  )
);

CREATE INDEX broker_run_intents_exact_lookup
  ON broker_run_intents (
    authorization_id, tenant_id, profile_id, profile_revision_digest,
    device_credential_id, device_fingerprint, run_intent_id, grant_id
  );

CREATE TRIGGER broker_run_intents_no_update
BEFORE UPDATE ON broker_run_intents BEGIN
  SELECT RAISE(ABORT, 'broker run intent is immutable');
END;
CREATE TRIGGER broker_run_intents_no_delete
BEFORE DELETE ON broker_run_intents BEGIN
  SELECT RAISE(ABORT, 'broker run intent is immutable');
END;
CREATE TRIGGER broker_owner_decisions_no_update
BEFORE UPDATE ON broker_owner_decisions BEGIN
  SELECT RAISE(ABORT, 'broker owner decision is immutable');
END;
CREATE TRIGGER broker_owner_decisions_no_delete
BEFORE DELETE ON broker_owner_decisions BEGIN
  SELECT RAISE(ABORT, 'broker owner decision is immutable');
END;
