# Spec Delta

## Purpose

Defines how Desktop Tools launches a pinned OpenCode provisioning session without allowing model output to bypass deterministic machine-change controls.

## ADDED Requirements

### Requirement: Pinned verified OpenCode runtime
The bootstrap SHALL install or select an approved immutable OpenCode version and verify its provenance before launching a provisioning session.

#### Scenario: Runtime unavailable
- **WHEN** no approved runtime can be verified for the target platform
- **THEN** provisioning stops before launching an alternative mutable or unapproved agent

### Requirement: Bounded provisioning prompt
Desktop Tools SHALL launch the approved runtime with a versioned prompt bound to the profile revision, machine facts, policy, and permitted tools.

#### Scenario: Prompt launch
- **WHEN** authorization and discovery complete
- **THEN** the session receives the exact prompt version and nonsecret context recorded in its plan

#### Scenario: Offline deterministic operation
- **WHEN** AI inference is unavailable but the selected operation has a complete deterministic plan
- **THEN** the supported standalone engine path remains available without fabricating agent success

### Requirement: Deterministic mutation authority
OpenCode MUST perform machine changes only through approved typed provisioning tools whose effects are planned, consented, journaled, verified, and bounded by the installer engine.

#### Scenario: Ambient shell mutation
- **WHEN** model output requests a privileged or state-changing command outside an approved tool capability
- **THEN** the operation is denied and cannot be converted into ambient shell authority

#### Scenario: Approved apply
- **WHEN** the operator approves a valid plan and the required capabilities are present
- **THEN** the engine applies only the plan-bound tasks and emits verified terminal evidence

### Requirement: Least-privilege session credentials
The session SHALL receive only the minimum environment values, filesystem paths, tools, secrets, and network destinations required by its approved plan.

#### Scenario: Session environment
- **WHEN** the OpenCode process starts
- **THEN** unrelated inherited secret-shaped variables and credentials are absent

### Requirement: Durable correlated session evidence
Every provisioning launch SHALL create durable session and recording metadata before the agent or PTY starts and correlate children, approvals, plan, profile, runtime, tools, costs, output gaps, and verification.

#### Scenario: Recording storage failure
- **WHEN** required session evidence cannot be durably initialized
- **THEN** the system reports the failure and does not claim a fully recorded provisioning run

#### Scenario: Child task
- **WHEN** OpenCode creates a child session or parallel task
- **THEN** its identity and result remain linked to the parent run and original authorization

### Requirement: Explicit terminal outcomes
The session SHALL distinguish verified success, failure, denial, cancellation, offline limitation, blocked prerequisite, pending reboot, and incomplete evidence.

#### Scenario: Agent exits without verification
- **WHEN** the agent process exits before required postconditions are verified
- **THEN** the run is not reported as successful
