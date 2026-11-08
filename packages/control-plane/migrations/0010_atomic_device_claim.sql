-- One SQL statement must both create the digest-only device credential and consume its pairing.
-- D1 executes each statement transactionally; the trigger aborts the INSERT unless it wins the
-- approved -> claimed transition. The unique pairing_code is the durable replay/collision boundary.
ALTER TABLE devices ADD COLUMN pairing_code TEXT REFERENCES pairings(code);
ALTER TABLE devices ADD COLUMN profile_revision TEXT;
ALTER TABLE devices ADD COLUMN machine_fingerprint TEXT;
ALTER TABLE devices ADD COLUMN expires_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_pairing_code ON devices(pairing_code) WHERE pairing_code IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS claim_pairing_after_device_insert
AFTER INSERT ON devices
WHEN NEW.pairing_code IS NOT NULL
BEGIN
  UPDATE pairings
     SET status = 'claimed', claimed_at = NEW.created_at, device_id = NEW.device_id
   WHERE code = NEW.pairing_code
     AND status = 'approved'
     AND expires_at > NEW.created_at;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'claim unavailable') END;
END;
