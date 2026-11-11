# Spec Delta

## Purpose

Defines accessible, consistent Desktop Tools experiences over one product model without allowing presentation layers to acquire independent mutation authority.

## ADDED Requirements

### Requirement: Every renderer consumes the same protocol
Web, TUI, plain text, JSON, NDJSON, headless, CI, and accessibility renderers SHALL consume the same plan and event protocol and SHALL produce identical terminal outcome semantics.

#### Scenario: Renderer crashes
- **WHEN** a renderer disconnects or crashes during an active run
- **THEN** the engine and journal remain correct and another authorized renderer can resume observation

### Requirement: Concurrent work remains attributable
Interactive renderers SHALL expose agent and task identity, dependencies, critical path, locks, retries, approval, cost, verification, bounded logs, and terminal status without mixing concurrent output.

#### Scenario: Narrow terminal resizes
- **WHEN** a terminal becomes narrow or receives resize events
- **THEN** essential task status and controls remain usable without losing event evidence

### Requirement: Profile customization compiles deterministically
The customization experience SHALL compile user choices into one versioned portable desired state, strict host overlays, catalog closure, service policy, and secret references with preview, migration, conflict explanation, and reproducible output.

#### Scenario: Two settings conflict
- **WHEN** selected settings require incompatible packages, services, or policies
- **THEN** compilation rejects the profile with an actionable conflict rather than choosing silently

### Requirement: Visual implementation requires approved design
The full customer-facing SaaS visual implementation MUST NOT begin until its current Figma artifact is explicitly approved; nonvisual contracts, APIs, accessibility requirements, and renderer-neutral foundations may proceed.

#### Scenario: No approved Figma artifact
- **WHEN** a task requires new customer-facing visual design and approval is absent
- **THEN** the task remains blocked while unrelated backend and contract work may continue

### Requirement: Embedded agent runtime remains least privilege
The Desktop Tools OpenCode-derived runtime SHALL use pinned owned sessions, typed tools, task-specific agents, policy-enforced permissions, bounded context, durable recordings, and explicit upgrades without exposing a public unrestricted shell.

#### Scenario: Session requests unrestricted shell
- **WHEN** an agent or plugin requests a shell outside the typed operation boundary
- **THEN** the runtime denies it and preserves the request as bounded audit evidence
