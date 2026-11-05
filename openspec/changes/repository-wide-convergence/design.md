# Design

> **Architect:** codex
> **Architect Role:** assigned

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

The approved 30-item program reopens convergence. Its implementation is dependency-ordered into five waves: (A) exploit and bootstrap safety; (B) secret, backup, and scheduler authority; (C) CI, catalog, and source provenance; (D) authenticated control-plane boundaries and observability; (E) consent, dependency modernization, and truthful documentation. A wave may proceed in parallel only across disjoint files and state; control-plane auth precedes state-changing or receipt endpoints, and independent recovery precedes destructive storage work.

## Cross-change ownership

`fleet-backup-recovery` owns Infisical authorization, backup-secret separation, scheduler reconciliation, ZFS discover/plan/apply/status, recovery escrow, restore evidence, and host rollout. This change owns repository enforcement and the remaining bootstrap, CI, control-plane, catalog, provenance, dependency, consent, and documentation work. `triad-convergence-langfuse-resilience` owns the Langfuse fail-open shell contract and Frontier-only OpenSpec authorship declaration; this change adds the mechanical verifier that prevents a non-Frontier author from passing validation.

Infisical is authoritative for operational secrets. Repository configuration stores references, not values. Local secrets are valid only for a declared machine-scoped offline/pre-network dependency and may never act as a silent general fallback. The independent recovery package is governed by `fleet-backup-recovery` and is not a second operational secret authority.

The approved Infisical program is enforced at repository boundaries as well as at runtime. `fleet-backup-recovery` owns I01–I30 behavior and host evidence. This change owns deterministic gates for manifest schema and immutability (I01–I06, I10), credential/reference leakage and CI federation (I07–I09, I13–I19, I24–I26, I29), authorization/telemetry/dashboard evidence (I11–I12, I22–I23, I27–I28), recovery-envelope provenance (I20–I21), and staged rollout receipts (I30). These gates consume redacted evidence and never require secret values in the repository.

Identity categories are non-substitutable: Cloudflare Access protects public human administration, GitHub/platform OIDC authenticates automation, Infisical workload identities authorize service secrets, Authentik is exceptional local/offline human access, and product-native auth owns customer accounts. A repository change that crosses these planes without a documented exception fails policy validation.

## Deterministic lazy-loading policy

Every installable catalog entry has a schema-validated `load_policy` and `load_rationale`. `lazy` is the default and requires no exception. Eager entries must use exactly one narrow class: `eager-bootstrap` for prerequisites required before the lazy resolver can work; `eager-supported-path` for a dependency inevitably exercised by a selected supported path; `eager-security-recovery` for security or recovery capability required before lazy infrastructure; or `eager-service` for an always-on service explicitly selected in the host's desired state. Eager entries also identify the consuming path, prerequisite, recovery obligation, or desired-state selector that justifies them. Popularity, convenience, historical preload status, optional integrations, and possible future use are not sufficient rationales.

Classification is deterministic from the versioned catalog, supported-path dependency graph, platform/role capability, and desired state. The same inputs produce the same ordered plan. Missing rationales, unknown classes, dependency cycles, eager services without explicit selection, and a lazy resolver that depends on an unavailable lazy package fail validation. Platform-specific entries may classify differently only through explicit platform/role overrides with their own rationale.

At runtime, interactive command discovery may install an eligible lazy package through the existing bounded, locked, provenance-checked path and then resume the original invocation. Noninteractive, privileged, offline, or policy-disabled contexts fail with an exact remediation rather than silently installing or partially configuring software. Supported workflows declare dependencies in advance so planning can install them as a transactional prerequisite. A failed lazy install leaves no success marker, duplicate task, service enablement, or ambiguous partial state; a later run can retry safely. Always-on services are never started merely because their package is discovered or installed.

Structured secret-free events record classification, reason code, trigger, platform/role, package, outcome, duration, fallback, and remediation. Metrics cover eager install count/time, shell/bootstrap startup budget, lazy cold/warm latency, failures, retries, offline fallbacks, and unused eager exceptions. Package names and bounded reason codes may be labels; commands, paths, errors, and run identifiers remain fields.

## Rollback

All mutations remain ordinary Git changes, grouped by subsystem with regression tests. No deploy or live-host mutation occurs. Generated outputs can be restored by their generator and removals remain recoverable from Git history.
