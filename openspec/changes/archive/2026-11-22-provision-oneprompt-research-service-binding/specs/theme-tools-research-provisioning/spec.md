## ADDED Requirements

### Requirement: Explicit consumer service-binding desired state

install.doctor SHALL validate value-free consumer-to-research service-binding declarations with explicit consumer and target environments and a server-controlled authority grant reference.

#### Scenario: OnePrompt staging binding

- **WHEN** OnePrompt declares a `RESEARCH` service binding to the canonical staging research Worker in the same declared environment
- **THEN** the planner emits deterministic non-mutating binding and authority-validation actions
- **AND** the plan contains no endpoint credential or token.

#### Scenario: Ambiguous or unsafe consumer binding

- **WHEN** a consumer binding duplicates a consumer binding name, targets an undeclared service or environment, or contains credential-like material
- **THEN** validation fails before any provider operation.

### Requirement: Narrow consumer-binding rollback

The planner SHALL preserve an existing binding and SHALL authorize removal only for a binding newly created by a separately authorized apply.

#### Scenario: Dry-run rollback metadata

- **WHEN** a consumer-binding action is planned
- **THEN** its rollback metadata preserves any existing binding and removes only a newly created binding.
