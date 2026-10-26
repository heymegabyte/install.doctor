-- aid control plane: History (S14 run registration, S15 searchable replay). One row per reported
-- aid event — an apply, a run, a check — keyed to the device + its tenant, newest-first. `detail` is a
-- JSON blob (plan summary / changes / cost / error) validated at the Worker boundary before insert.
CREATE TABLE IF NOT EXISTS history (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  tenant     TEXT NOT NULL,
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  revision   TEXT,
  summary    TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_device ON history(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_history_tenant ON history(tenant, created_at);
