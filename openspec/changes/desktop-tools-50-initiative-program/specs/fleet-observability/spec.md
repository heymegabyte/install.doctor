# Spec Delta

## Purpose

Defines complete, secret-safe operational evidence across Desktop Tools hosts, agents, releases, provisioning, protection jobs, and recovery workflows.

## ADDED Requirements

### Requirement: Telemetry uses one versioned semantic model
Plans, runs, tasks, locks, approvals, agent calls, changes, retries, costs, verification, rollback, backups, and recovery SHALL share bounded correlated logs, metrics, traces, events, and resource identities.

#### Scenario: Parallel child operations
- **WHEN** several agents or tasks emit output concurrently
- **THEN** every signal remains attributable to its tenant, host, run, parent, task, and bounded service identity

### Requirement: Collection is durable and fail open to host operation
Applicable hosts SHALL use supported collectors with bounded local buffering, retry, last-known-valid configuration, deduplication, redaction, and explicit delivery health; telemetry outage MUST NOT authorize mutation or block safe local recovery.

#### Scenario: Remote configuration is invalid
- **WHEN** a collector receives invalid remote telemetry configuration
- **THEN** it retains the last valid pipeline or recovery-safe local pipeline and reports the rejected revision

### Requirement: Operational states are truthful
Dashboards and APIs SHALL distinguish unknown, stale, queued, running, pending approval, blocked, failed, uncertain, rolled back, restored, and verified states using source evidence rather than optimistic process health.

#### Scenario: Collector is running without ingestion
- **WHEN** the collector process is healthy but a correlated test event cannot be queried at the destination
- **THEN** delivery is not reported verified

### Requirement: SLOs drive rollout decisions
The system SHALL define service-level indicators, objectives, and error budgets for bootstrap, enrollment, planning, execution, verification, reconciliation, secret delivery, telemetry, and recovery.

#### Scenario: Error budget is exhausted
- **WHEN** a release or cohort exhausts its applicable error budget
- **THEN** dependent promotion pauses and operators receive evidence and recovery guidance
