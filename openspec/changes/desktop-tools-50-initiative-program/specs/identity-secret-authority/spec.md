# Spec Delta

## Purpose

Defines least-privilege identities and secret delivery for owners, hosts, services, CI, agents, approvals, recovery, and offline dependencies.

## ADDED Requirements

### Requirement: Every workload has an exact scoped identity
Each host, service, CI workflow, agent, and maintenance operation SHALL receive a distinct identity limited by tenant, project, environment, path, action, lifetime, and intended consumer.

#### Scenario: Caller widens a secret scope
- **WHEN** a workload supplies a path, environment, project, or action outside its manifest
- **THEN** access fails without falling back to controller or broader credentials

### Requirement: Secret delivery minimizes exposure
Secret consumers SHALL receive only declared values through protected runtime delivery, with inherited credential-shaped variables removed and no values in arguments, logs, recordings, reports, or durable plaintext caches.

#### Scenario: Service requests one credential
- **WHEN** a service starts through its scoped launcher
- **THEN** its environment contains only its exact declared nonsecret baseline and secret mappings

### Requirement: Credential lifecycle is verified
Enrollment, renewal, dual-phase rotation, revocation, rebuild recovery, and historical-key retention SHALL be exercised without discarding material required by retained backups.

#### Scenario: Host is revoked
- **WHEN** an operator revokes a host identity
- **THEN** future operational access fails while authorized historical recovery remains possible

### Requirement: Offline exceptions are explicit
Local secret material SHALL be limited to declared pre-network, boot, offline execution, or independent recovery dependencies with owner, purpose, protection, expiry, and rotation metadata.

#### Scenario: Online secret service fails
- **WHEN** an ordinary online workload cannot reach the secret authority
- **THEN** it fails closed instead of using an undeclared local fallback

### Requirement: Privileged approval is phishing resistant and exact
Owner authentication and approval SHALL bind origin, actor, reauthentication, target identity, profile revision, plan digest, scope, expiry, and one-time use; privileged actions SHALL support phishing-resistant authenticators.

#### Scenario: Approval is replayed
- **WHEN** an approval is claimed again or for a substituted plan, target, or profile
- **THEN** authorization fails and emits a correlated audit event

### Requirement: Agent authority is task scoped
Every agent SHALL run with an explicit filesystem, command, network, tool, skill, subagent, secret, step, and budget policy; child authority MUST NOT exceed its admitted task.

#### Scenario: Agent requests undeclared tool
- **WHEN** an agent attempts a tool or resource outside its task policy
- **THEN** the request is denied independently of model output or auto-approval mode
