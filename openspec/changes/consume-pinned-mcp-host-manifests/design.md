# Design

**Architect Role:** assigned

The pin manifest names the canonical Git revision, raw artifact base URL, shared source digest, and SHA-256 for the generated index plus four host manifests. The consumer accepts only the closed macOS/Ubuntu profile pair and verifies file bytes, schema version, profile ID, source digest, host selector, atomic merge policy, predecessor-snapshot requirement, and runtime-secret-reference ownership before creating a plan.

Apply is explicit. The installer prepares all outputs first, rejects collisions with existing managed MCP names, preserves unknown client entries, snapshots every predecessor with mode `0600`, writes temporary files in the destination directory, and renames them atomically. If a later write fails, already-written outputs are restored. Rollback verifies the installed digest before restoring its predecessor so it cannot overwrite subsequent operator changes.

Automation credentials remain references only. The consumer never resolves, prints, or writes credential values.
