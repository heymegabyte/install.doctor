-- Durable, concurrency-safe poll cadence. A conditional UPDATE in the Worker admits at most one
-- poll per interval even when requests arrive concurrently at different Worker isolates.
ALTER TABLE pairings ADD COLUMN last_polled_at TEXT;
