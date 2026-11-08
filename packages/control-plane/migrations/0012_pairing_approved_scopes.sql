-- Owner-approved authority is distinct from machine-requested authority. Nullable preserves legacy
-- approvals; new Desktop Tools owner decisions persist an explicit narrowed JSON scope array.
ALTER TABLE pairings ADD COLUMN approved_scopes TEXT;
