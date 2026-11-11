-- Immutable owner-reviewed privileged-plan authority. The reviewed artifact is persisted separately
-- from the caller run intent and is re-admitted against freshly reconstructed server authority before
-- either an owner decision or a signed privileged approval can have effect.
CREATE TABLE broker_reviewed_plan_bindings (
  run_intent_id  TEXT PRIMARY KEY REFERENCES broker_run_intents(run_intent_id),
  review_id      TEXT NOT NULL UNIQUE,
  binding_digest TEXT NOT NULL UNIQUE CHECK (length(binding_digest) = 64),
  binding_json   TEXT NOT NULL CHECK (json_valid(binding_json)),
  recorded_at    TEXT NOT NULL
);

CREATE TRIGGER broker_reviewed_plan_bindings_no_update
BEFORE UPDATE ON broker_reviewed_plan_bindings BEGIN
  SELECT RAISE(ABORT, 'broker reviewed plan binding is immutable');
END;

CREATE TRIGGER broker_reviewed_plan_bindings_no_delete
BEFORE DELETE ON broker_reviewed_plan_bindings BEGIN
  SELECT RAISE(ABORT, 'broker reviewed plan binding is immutable');
END;
