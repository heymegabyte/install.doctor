# Design

## Coverage model

The tracked-file list is the source of truth. A deterministic audit assigns every path to one of: source, test, script, configuration, documentation, generated, encrypted, binary/media, vendored, or empty/sentinel. Each class has required validators. The final ledger must contain exactly one record for every `git ls-files` path and reject duplicates or omissions.

Semantic review is sharded by dependency closure rather than arbitrary file count. Repository summaries and OpenCode workers inspect bootstrap/home automation, aid/control-plane, site/docs, and repository/tooling/assets independently. The premium parent resolves conflicts, owns sensitive decisions, applies patches, and verifies the integrated tree.

## Decision policy

Findings are scored by impact, confidence, effort, risk, and reversibility. Implement automatically when evidence is high-confidence, the action is reversible, tests can prove it, and no external authority is needed. Record rather than implement speculative redesigns, destructive migrations, decoded-secret changes, or changes that conflict with project doctrine.

## File-class verification

- Source/scripts/config: parser, type, lint, schema, tests, call-site and dead-code analysis.
- Docs: link/reference accuracy, contradiction/staleness, spelling where reliable, and executable snippet validation.
- Generated: regenerate and compare; never hand-edit when a canonical generator exists.
- Encrypted: vault/header, filename, mode, and reference integrity only; never decrypt for this audit.
- Binary/media: magic type, extension agreement, dimensions/decodability, duplicate hash, reference/orphan analysis, and size thresholds.
- Empty/sentinel: explicit allowlist or defect.

## Convergence

Run the full inventory and validators, implement winners, rerun, then perform two consecutive independent finding passes. Convergence means neither pass produces a new actionable finding above the recorded threshold; it does not mean every file changes.

## Rollback

All mutations remain ordinary Git changes, grouped by subsystem with regression tests. No deploy or live-host mutation occurs. Generated outputs can be restored by their generator and removals remain recoverable from Git history.
