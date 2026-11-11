# Spec Delta

## Purpose

Defines one truthful, authenticated Desktop Tools lifecycle from a profile URL through verified host state, durable evidence, and recoverable operation.

## ADDED Requirements

### Requirement: Profile bootstrap reaches one verified lifecycle
Desktop Tools SHALL bind profile revision, target identity, release, plan, approval, execution, verification, and receipt into one traceable lifecycle without treating an intermediate artifact or started process as success.

#### Scenario: Successful headless provisioning
- **WHEN** an enrolled headless target invokes its profile URL and the approved plan completes
- **THEN** the owner and target receive a terminal verified receipt bound to the exact profile, release, plan, journal, and postconditions

#### Scenario: Incomplete lifecycle
- **WHEN** enrollment, approval, execution, or verification remains pending or fails
- **THEN** the lifecycle reports its exact non-success state and preserves safe resume or recovery evidence

### Requirement: Browser and local clients share session truth
Every browser, terminal, scheduled, child, and offline run SHALL use the same durable session identity, bounded event protocol, authorization state, and terminal semantics.

#### Scenario: Browser reconnect
- **WHEN** a browser disconnects and reconnects to an active authorized run
- **THEN** it resumes from acknowledged output without creating another host run or losing terminal state

### Requirement: Product claims follow deployed evidence
Public and authenticated product surfaces MUST derive capability status from current deployment and verification evidence and MUST distinguish contract-only, available, blocked, stale, and verified behavior.

#### Scenario: Contract exists without deployment
- **WHEN** a capability has repository contracts but no valid production or platform receipt
- **THEN** every product surface labels it unavailable or experimental rather than shipped
