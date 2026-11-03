# Repository-wide convergence audit

## Why

Install Doctor spans fleet bootstrap, dotfiles, system automation, an isolated aid foundation, a Cloudflare control plane, a documentation site, generated catalogs, encrypted configuration, and media assets. Piecemeal reviews leave cross-subsystem drift and do not prove that every tracked path was considered.

## What changes

- Build a versioned coverage ledger for every tracked path, recording its class, applicable validators, semantic-review status, findings, and disposition.
- Audit source, configuration, tests, documentation, infrastructure, workflows, agent instructions, generated artifacts, encrypted files, and binary/media assets with class-appropriate checks.
- Implement every high-confidence, in-scope improvement whose value exceeds its regression and migration risk.
- Add gates that prevent discovered defect classes from recurring.
- Repeat the architecture loop until two consecutive passes find no new justified change above the value threshold.

## Capabilities

- `repository-convergence`: complete per-file accounting, prioritized findings, safe automated remediation, and convergence evidence.
- `repository-quality-gates`: reusable validation of source, generated, encrypted, and binary file classes.

## Boundaries

- Preserve user-authored dirty-worktree changes and do not rewrite healthy files merely to create churn.
- Do not decode secrets, replace running applications, uninstall live services, deploy, or make external infrastructure changes without separate authorization.
- Full visual redesign remains blocked on approved Figma designs; this change may fix objective accessibility, correctness, and content defects without redesigning the product.
