-- P05: persist the GRANTED permission scope on the device at claim (copied from the pairing it was
-- approved against), so the identity → approve → grant loop is recorded and future per-action
-- enforcement has a source of truth. Additive + nullable (blast-radius 0): existing devices read as
-- "no recorded scope". Stored as a JSON array of capability strings.
ALTER TABLE devices ADD COLUMN permissions TEXT;
