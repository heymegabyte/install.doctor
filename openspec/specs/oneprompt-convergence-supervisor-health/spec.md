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
