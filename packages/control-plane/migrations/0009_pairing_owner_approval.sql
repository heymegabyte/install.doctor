-- Owner-bound approval context. Nullable columns preserve legacy pairings while the Desktop Tools
-- bootstrap uses the stricter owner-decision endpoint. The machine supplies no credential here;
-- approval is bound to a freshly authenticated intended owner and the displayed immutable context.
ALTER TABLE pairings ADD COLUMN machine_fingerprint TEXT;
ALTER TABLE pairings ADD COLUMN profile_revision TEXT;
ALTER TABLE pairings ADD COLUMN owner_actor TEXT;
ALTER TABLE pairings ADD COLUMN decided_by TEXT;
ALTER TABLE pairings ADD COLUMN denied_at TEXT;
