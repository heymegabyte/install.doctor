-- Application-level privileged intent binding around Better Auth's verified
-- WebAuthn ceremony. Challenge values and WebAuthn responses are never stored;
-- only the application challenge digest and verified credential identifier are retained.
CREATE TABLE IF NOT EXISTS privileged_step_up_challenges (
  id TEXT NOT NULL PRIMARY KEY,
  challenge_sha256 TEXT NOT NULL UNIQUE CHECK (length(challenge_sha256) = 64),
  actor TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin = 'https://desktop.tools'),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('device', 'host', 'plan', 'recovery')),
  target_id TEXT NOT NULL,
  plan_digest TEXT NOT NULL CHECK (length(plan_digest) = 64),
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'consumed', 'revoked')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  verified_session_id TEXT,
  credential_id TEXT,
  credential_revocation_epoch INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  revoked_at TEXT,
  CHECK (expires_at > issued_at),
  CHECK ((status = 'pending' AND verified_at IS NULL AND verified_session_id IS NULL AND credential_id IS NULL)
      OR (status = 'verified' AND verified_at IS NOT NULL AND verified_session_id IS NOT NULL AND credential_id IS NOT NULL)
      OR (status = 'consumed' AND verified_at IS NOT NULL AND verified_session_id IS NOT NULL AND credential_id IS NOT NULL AND consumed_at IS NOT NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

CREATE INDEX privileged_step_up_actor_status_idx
  ON privileged_step_up_challenges (actor, status, expires_at);

CREATE TABLE IF NOT EXISTS passkey_recovery_events (
  id TEXT NOT NULL PRIMARY KEY,
  actor TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('recovery-started', 'credential-registered', 'credential-revoked')),
  credential_id TEXT,
  session_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

CREATE INDEX passkey_recovery_actor_idx ON passkey_recovery_events (actor, occurred_at);
