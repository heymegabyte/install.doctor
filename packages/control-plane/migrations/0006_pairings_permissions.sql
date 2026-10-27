-- P03 (fuller): the device declares the PERMISSIONS (capability scope) it requests at pairing, so the
-- approver sees what access they are granting before approving. Additive + nullable (backward-additive,
-- blast-radius 0): existing pairings read as "no declared scope". Stored as a JSON array of strings.
ALTER TABLE pairings ADD COLUMN permissions TEXT;
