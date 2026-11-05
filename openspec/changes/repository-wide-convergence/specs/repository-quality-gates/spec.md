# Repository quality gates delta

## Purpose

Defines durable automated gates that prevent repository-wide correctness, provenance, hygiene, and generated-file drift from recurring.

## ADDED Requirements

### Requirement: Deterministic audit output

Repository audit output SHALL be schema-versioned, deterministically ordered, secret-free, and reproducible from tracked source.

#### Scenario: Repeated unchanged run

- **WHEN** the audit runs twice against the same Git tree and tool versions
- **THEN** its tracked-path dispositions are identical apart from explicitly volatile timestamps

### Requirement: Dirty-worktree preservation

Automated remediation SHALL distinguish pre-existing modifications and SHALL not overwrite unrelated user changes.

#### Scenario: Overlapping modified file

- **WHEN** a finding touches a file already modified by the user
- **THEN** the patch preserves compatible edits or records the overlap instead of resetting the file

### Requirement: Generated-file provenance

Generated artifacts SHALL identify a canonical generator and SHALL be verified by regeneration or an equivalent deterministic integrity check.

#### Scenario: Generated catalog drift

- **WHEN** source catalog data changes
- **THEN** the gate detects a committed generated catalog that was not regenerated

### Requirement: Bootstrap provenance and least privilege

Bootstrap SHALL preserve local work, verify remote artifacts and SSH identities before trust, use argv-safe command dispatch, and grant only bounded temporary privilege.

#### Scenario: Untrusted forced command

- **WHEN** a replication identity supplies shell syntax, an unknown flag, or a dataset outside its allowlist
- **THEN** the dispatcher rejects it without invoking a shell

### Requirement: Required CI tests the proposed revision

Required CI SHALL execute the checked-out revision, fail real validation errors, distinguish explicit platform skips, and SHALL NOT use production or mutable remote code as the pull-request test subject.

#### Scenario: Pull-request validation

- **WHEN** a pull request changes bootstrap or generated catalog behavior
- **THEN** required CI tests that checkout and fails on a real regression without fetching production code as its subject

### Requirement: Runtime-boundary validation

Requests, bindings, provider responses, persisted records, events, and generated catalog input SHALL be parsed with strict runtime schemas; unknown fields, oversized bodies, unauthenticated access, invalid receipts, and broadened scope SHALL fail closed with redacted bounded errors.

#### Scenario: Malformed unauthenticated request

- **WHEN** a caller submits an oversized or schema-invalid body without valid scope
- **THEN** the control plane rejects it before provider or storage access and returns a bounded redacted error

### Requirement: Truthful product and documentation surfaces

Public documentation, navigation, metadata, PWA behavior, and API success responses SHALL describe implemented and verified behavior only. Isolated experimental contracts and unconfigured provider actions SHALL NOT be presented as shipped success.

#### Scenario: Experimental aid contract

- **WHEN** a capability exists only as an isolated unit-tested contract in `aid-core`
- **THEN** public product surfaces label it experimental and do not claim that bootstrap, routing, daemon, or UI integration is shipped

### Requirement: Mechanical OpenSpec architect gate

Planning artifacts SHALL declare `claude`, `codex`, or `antigravity` as Architect and automated validation SHALL reject missing, invalid, or OpenCode architectural authorship.

#### Scenario: Non-Frontier architecture author

- **WHEN** a proposal or design declares OpenCode or omits an approved Architect
- **THEN** repository validation fails before implementation can be marked complete

### Requirement: Consent-before-load analytics

Nonessential analytics and tag-manager code SHALL NOT load before explicit consent and SHALL stop after revocation; acceptance, rejection, and revocation SHALL be independently testable.

#### Scenario: Visitor rejects analytics

- **WHEN** a visitor rejects or revokes nonessential analytics consent
- **THEN** tag-manager and analytics network requests are absent while essential site behavior remains functional

### Requirement: Secret-governance evidence gates

Repository validation SHALL enforce the workload manifest, immutable production scopes, exact-name delivery, credential lifetime, federated CI claims, inherited-permission detection, local-exception policy, recovery-envelope provenance, allowed/denied tests, leak checks, telemetry/status evidence, rotation drills, and staged rollout receipts defined by `fleet-backup-recovery` I01–I30.

#### Scenario: Documentation without runtime evidence

- **WHEN** an Infisical requirement is described or configured but lacks its required redacted authorization, lifecycle, leak, rotation, or rollout evidence
- **THEN** the gate keeps the requirement incomplete and does not treat generated configuration as verified operation

### Requirement: Authentication-plane validation

Repository policy SHALL distinguish Cloudflare Access public-human authorization, claim-bound CI/platform OIDC, scoped Infisical service identities, exceptional local/offline Authentik access, and product-native customer authentication.

#### Scenario: Conflicting identity authority

- **WHEN** a change uses one identity system outside its assigned plane without a documented incompatibility and compensating controls
- **THEN** validation fails before deployment and identifies the expected authority without exposing credentials
