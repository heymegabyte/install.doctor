-- aid control plane: the stored authoritative blueprint per tenant (one "current" row each).
-- The stored artifact is the ENVIRONMENT.md Markdown (the single source); revision + digest are
-- derived on read via aid-core (importMarkdown + blueprintDigest), so this table never competes
-- with the document as the authority. Write + revision-check + auth land in a later fire.
CREATE TABLE IF NOT EXISTS blueprints (
  tenant     TEXT PRIMARY KEY,
  markdown   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
