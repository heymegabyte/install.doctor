# Spec Delta

## MODIFIED Requirements

### Requirement: Safe curl-pipe entrypoint

The profile `/start` response SHALL remain a minimal bounded launcher that downloads an immutable release into a private temporary directory, authenticates its delegated signature, expiry, product, platform, and origin before executing a local file, SHALL NOT use process substitution or mutable fallback, and SHALL reconnect interactive stdin to `/dev/tty` when available.

#### Scenario: Interactive invocation

- **WHEN** a user runs `curl -fsSL https://<profile>.desktop.tools | bash` in a terminal
- **THEN** prompts read from the terminal and only an authentic current profile-bound release may execute

#### Scenario: Headless invocation

- **WHEN** no terminal is available
- **THEN** the launcher selects headless mode and supplies `/dev/null` as stdin

#### Scenario: Release verification fails

- **WHEN** origin, transport, signature, delegation, expiry, product, platform, size, or digest verification fails
- **THEN** the launcher executes nothing and removes private staging material when safe

### Requirement: Bounded execution

Independent installer tasks SHALL start only through the typed engine's bounded resource-aware ready queue. Package-manager, privileged, storage, service, and configuration mutations SHALL be serialized by declared lock domains; cancellation SHALL clean up children; any failure SHALL produce a non-zero typed outcome and SHALL block dependent work without blocking unrelated safe branches.

#### Scenario: Concurrent install

- **WHEN** more tasks are ready than the configured worker or resource limit
- **THEN** no more than the admitted number start and every failure remains attributable

#### Scenario: Shared mutation domain

- **WHEN** ready operations require the same exclusive mutation domain
- **THEN** they execute serially even when global concurrency remains available

### Requirement: Plan before mutation

Interactive, headless, offline, and resumed runs SHALL resolve release, host identity, facts, role, capabilities, dependency closure, network actions, privileges, secrets references, consents, locks, resources, rollback limits, and concurrency into one durable approved plan before applying system changes.

#### Scenario: Headless plan

- **WHEN** environment values select a headless role and capabilities
- **THEN** a versioned JSON plan is persisted without prompting and mutation still requires its admitted authority

#### Scenario: Observed facts change before apply

- **WHEN** a safety-relevant host fact no longer matches the approved plan
- **THEN** apply invalidates the plan and requires rediscovery rather than mutating under stale assumptions

## ADDED Requirements

### Requirement: Bootstrap completion requires verification evidence
Bootstrap SHALL report success only after all required postconditions, restart-survival checks, and terminal receipt bindings are verified.

#### Scenario: Configuration was generated but service failed
- **WHEN** generated configuration is valid but its required service cannot reach the verified desired state
- **THEN** bootstrap reports failure or pending recovery rather than success
