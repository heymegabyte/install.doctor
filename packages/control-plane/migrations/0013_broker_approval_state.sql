-- Immutable, exact authority state for one privileged broker run. The complete grant and release
-- delegation remain append-only audit evidence; duplicated binding columns make request matching
-- explicit and indexable without trusting JSON extraction at the authorization boundary.
CREATE TABLE broker_approval_states (
  authorization_id        TEXT PRIMARY KEY,
  owner_decision_id        TEXT NOT NULL UNIQUE,
  owner_actor_id           TEXT NOT NULL,
  owner_decision           TEXT NOT NULL CHECK (owner_decision = 'approved'),
  owner_reauthenticated_at TEXT NOT NULL,
  tenant_id                TEXT NOT NULL,
  profile_id               TEXT NOT NULL,
  profile_revision_digest  TEXT NOT NULL CHECK (length(profile_revision_digest) = 64),
  device_credential_id     TEXT NOT NULL,
  device_fingerprint       TEXT NOT NULL CHECK (length(device_fingerprint) = 64),
  run_intent_id            TEXT NOT NULL UNIQUE,
  grant_id                 TEXT NOT NULL UNIQUE,
  status                   TEXT NOT NULL CHECK (status = 'approved'),
  grant_json               TEXT NOT NULL CHECK (json_valid(grant_json)),
  delegation_json          TEXT NOT NULL CHECK (json_valid(delegation_json)),
  created_at               TEXT NOT NULL,
  UNIQUE (authorization_id, owner_decision_id, run_intent_id),
  UNIQUE (
    authorization_id, owner_decision_id, tenant_id, profile_id,
    profile_revision_digest, device_credential_id, device_fingerprint,
    run_intent_id, grant_id
  )
);

-- A receipt is inserted only by selecting an exact approved state. authorization_id uniqueness is
-- the one-use boundary; approval_id uniqueness also rejects an accidental identifier collision.
CREATE TABLE broker_approval_consumptions (
  approval_id       TEXT PRIMARY KEY,
  authorization_id  TEXT NOT NULL UNIQUE REFERENCES broker_approval_states(authorization_id),
  owner_decision_id TEXT NOT NULL,
  run_intent_id     TEXT NOT NULL,
  consumed_at       TEXT NOT NULL,
  FOREIGN KEY (authorization_id, owner_decision_id, run_intent_id)
    REFERENCES broker_approval_states(authorization_id, owner_decision_id, run_intent_id)
);

CREATE TRIGGER broker_approval_states_no_update
BEFORE UPDATE ON broker_approval_states BEGIN
  SELECT RAISE(ABORT, 'broker approval state is immutable');
END;
CREATE TRIGGER broker_approval_states_no_delete
BEFORE DELETE ON broker_approval_states BEGIN
  SELECT RAISE(ABORT, 'broker approval state is immutable');
END;
CREATE TRIGGER broker_approval_consumptions_no_update
BEFORE UPDATE ON broker_approval_consumptions BEGIN
  SELECT RAISE(ABORT, 'broker approval consumption is immutable');
END;
CREATE TRIGGER broker_approval_consumptions_no_delete
BEFORE DELETE ON broker_approval_consumptions BEGIN
  SELECT RAISE(ABORT, 'broker approval consumption is immutable');
END;
