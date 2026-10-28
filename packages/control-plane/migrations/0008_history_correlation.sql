-- U03: track parent/child runs across agents/hosts. A single logical run (e.g. one `aid up` that does
-- plan → apply → report, or a parent run that spawns child runs on other hosts) shares ONE correlation_id;
-- a child run records its parent's run id. Both additive + nullable (blast-radius 0): existing history rows
-- read as uncorrelated (null). The Worker bounds both at the report boundary (Zod max 200).
ALTER TABLE history ADD COLUMN correlation_id TEXT;
ALTER TABLE history ADD COLUMN parent_run_id TEXT;
CREATE INDEX IF NOT EXISTS idx_history_correlation ON history(tenant, correlation_id, created_at);
