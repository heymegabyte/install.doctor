# oneprompt-convergence-supervisor-health Specification

## Purpose

Defines trustworthy portable health reporting for bounded convergence workers that alternate between active execution and timer-scheduled waiting.

## Requirements

### Requirement: Timer-scheduled waiting is observable independently from active execution

The portable supervisor adapter SHALL distinguish an actively executing worker, a loaded timer-driven schedule between bounded invocations, and an inactive or unavailable manager definition.

#### Scenario: bounded launchd pass exits while running intent remains

- **WHEN** the canonical launchd job is loaded, its bounded worker has exited, durable intent remains `running`, no owner is current, and controller worker liveness is `waiting`
- **THEN** status reports `managerState: scheduled` and healthy service operation without claiming that a worker process is active

#### Scenario: schedule is not admitted

- **WHEN** neither an active worker nor a loaded/enabled canonical schedule exists
- **THEN** status reports `managerState: inactive` and does not report healthy convergence

#### Scenario: timer is scheduled but ownership is stale

- **WHEN** the manager schedule exists but controller state retains a current owner or reports non-waiting worker liveness without an active process
- **THEN** status remains unhealthy and exposes the controller evidence for reconciliation

### Requirement: Explicit recovery of an orphaned canonical definition

The adapter SHALL require an explicit absent predecessor path and a qualified destination before changing a recognized inactive orphaned OnePrompt launchd definition.

#### Scenario: Replace an orphaned checkout while preserving stop

- **GIVEN** the canonical predecessor has an absent checkout and matches the expected OnePrompt program, state and environment
- **WHEN** an operator adopts it to a validated pinned checkout
- **THEN** the adapter preserves the prior definition, installs the destination inactive, and preserves stopped intent

#### Scenario: Reject an unrelated definition

- **GIVEN** an absent predecessor was supplied but the definition points elsewhere or has an unrecognized environment
- **WHEN** the operator attempts adoption
- **THEN** the adapter denies it before any manager or file mutation
