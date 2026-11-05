# Fleet backup and recovery delta

## ADDED Requirements

### Requirement: Validated desired state and separate evidence

The system SHALL reject unknown policy fields, invalid secret references, unsupported capability combinations, overlapping scheduler ownership, and incomplete destination identity before mutation, and SHALL keep observed proof separate from desired state.

#### Scenario: Invalid desired state

- **WHEN** a manifest contains an unknown field, missing secret reference, conflicting scheduler, or incomplete destination identity
- **THEN** planning fails before mutation and the observed-evidence store remains unchanged

### Requirement: Safe ZFS assessment and repair gating

The system SHALL collect pool, dataset, device, boot, health, event, encryption, snapshot, and backup evidence without mutation. It SHALL NOT plan destructive repair until device identity, backup, hardware, and maintenance prerequisites are explicit.

#### Scenario: Ambiguous degraded pool

- **WHEN** a degraded pool lacks an unambiguous device identity, verified backup, replacement decision, or maintenance authorization
- **THEN** discovery records redacted diagnostics and the repair plan remains blocked without clearing errors or mutating the pool

### Requirement: Layered recovery

Applicable workloads SHALL have separately reported snapshots, replication, independent encrypted backup, integrity verification, and restore drills. Local snapshots SHALL NOT count as independent backup.

#### Scenario: Snapshot-only protection

- **WHEN** a workload has current local snapshots but no verified copy outside the source failure domain
- **THEN** status reports snapshot protection separately and independent recovery remains unverified

### Requirement: Least-privilege secrets and offline recovery

Infisical SHALL be the authoritative operational secret store behind `get-secret`. Target reads SHALL use scoped workload identities with desired-state-bound project, environment, path, and action permissions and SHALL reject caller attempts to broaden scope.

#### Scenario: Infisical outage during ordinary operation

- **WHEN** an enrolled target cannot reach or authenticate to Infisical after bootstrap
- **THEN** `get-secret` fails without consulting a controller keyring, committed file, age/SOPS operational store, or stale general-purpose cache

### Requirement: Bounded local bootstrap and independent recovery

A machine-local secret SHALL be permitted only for an explicitly declared pre-network, offline, or recovery dependency. Such material SHALL be machine-scoped, protected at rest, lifecycle-bounded, unavailable to ordinary callers after its boundary, and represented in the authorization matrix. A separately held encrypted recovery package SHALL recover covered historical keys without Infisical or the controller, while master recovery material remains off ordinary target hosts.

#### Scenario: Declared offline bootstrap dependency

- **WHEN** a host must unlock a prerequisite before networking or Infisical is available
- **THEN** only that host's declared protected bootstrap material is accessible for the bounded operation and unrelated secret names remain denied

#### Scenario: Independent recovery

- **WHEN** Infisical, the controller, and the source host are unavailable
- **THEN** the separately held recovery package can unlock every covered retained key type in an isolated trusted environment without exposing the master material to an ordinary target

### Requirement: Verifiable observability

Alloy SHALL collect redacted bounded-label system and protection-job events and a harmless per-host probe SHALL be queryable from the authorized Loki tenant before ingestion is marked verified.

#### Scenario: Collector is running without query proof

- **WHEN** Alloy is healthy but the uniquely identified host probe cannot be queried from the authorized Loki tenant
- **THEN** ingestion status remains unverified and exposes the routing or permission failure without secret values

### Requirement: Honest reconciliation

Repeated unchanged reconciliation SHALL create no duplicate identities, configuration, schedules, snapshots, or jobs. Running and pending work SHALL not be reported as verified.

#### Scenario: Reapply unchanged policy

- **WHEN** reconciliation runs twice against unchanged desired and observed state
- **THEN** the second plan contains no duplicate mutation and retains accurate running, pending, failed, stale, or verified status

### Requirement: Workload-scoped identity authority

Each workload SHALL have an independently revocable Infisical identity and a versioned immutable mapping to project, environment, fixed path, exact secret names, authentication mode, claims, and delivery mechanism. Federation or platform-native identity SHALL be preferred; Universal Auth SHALL be finite-lived and limited to incompatible runtimes. Inherited additive grants SHALL be evaluated before verification.

#### Scenario: Shared or broadenable identity

- **WHEN** an identity is shared across workloads, inherits a broader role, or accepts a production project/environment/path override
- **THEN** enrollment is overbroad, deployment is blocked, and no narrow grant is reported as canceling the broad permission

### Requirement: Deliberate authentication-plane split

Public operator access SHALL use Cloudflare Access; CI/platform workloads SHALL use claim-bound GitHub or platform-native OIDC where supported; services SHALL use scoped Infisical machine identities; Authentik SHALL be limited to documented local/offline human access or a concrete incompatibility; customer accounts SHALL remain product-native.

#### Scenario: Identity system proposed outside its plane

- **WHEN** Authentik is proposed for ordinary public access, Cloudflare Access for product customer accounts, or a host/fleet credential for independent services
- **THEN** policy validation rejects the mapping unless the allowed documented exception and compensating controls are present

### Requirement: Allowlisted secret delivery

Single values SHALL resolve through `get-secret`; multi-value services SHALL use the manifest-driven launcher. Delivery SHALL include exact allowlists, scrub unrelated secret-shaped parent variables, prefer native credential mounts/bindings, protect and clean rendered templates, and block absent, unauthorized, or out-of-manifest references.

#### Scenario: Parent environment contains unrelated credentials

- **WHEN** a workload launches from a process containing unrelated secret-shaped variables
- **THEN** the child receives only its manifest allowlist and leak checks find no unrelated value in its environment, process listing, logs, crash output, recording, or generated configuration

### Requirement: Credential lifecycle and revocation

Tokens and Universal Auth credentials SHALL have deliberate finite limits and alerts. Rotation SHALL prove consumer reload before retiring the previous version. Urgent revocation SHALL remove the issuing credential or identity and measure any cached-token window.

#### Scenario: Rotating a workload credential

- **WHEN** a new credential version is issued
- **THEN** the consumer reloads and passes a bounded health check before the prior version is revoked, with rollback possible during the overlap

### Requirement: Explicit offline and recovery exceptions

Infisical Agent SHALL NOT be assumed to provide general offline caching. Every local exception SHALL document threat model, expiry, revocation, ownership, and denial boundaries. Age SHALL be limited to an independently held recovery envelope, and historical recovery keys SHALL remain until dependent backups expire or are re-keyed.

#### Scenario: Offline access without exception policy

- **WHEN** a workload attempts to use cached or local secret material without the required exception metadata
- **THEN** access fails closed and the workload remains unverified rather than silently falling back

### Requirement: Authorization evidence and status

Every workload SHALL have automated allowed and denied tests across host, repository, environment, parent path, administration, and recovery-root boundaries. Metadata-only telemetry and alerts SHALL expose identity, workload, reference, action, outcome, unusual denials, parent-path attempts, auth changes, and expiration. Repository status SHALL distinguish unenrolled, manifest missing, overbroad, verified, stale, and revoked.

#### Scenario: Cross-boundary read attempt

- **WHEN** a workload requests a secret outside any manifest boundary
- **THEN** the read is denied, the value is never logged, metadata-only evidence is emitted, and unusual attempts alert without high-cardinality secret values

### Requirement: Staged secret rollout

Secret-policy and identity changes SHALL deploy to fixtures, then one canary per runtime class, then bounded estate batches with automatic configuration rollback. A failed class SHALL stop its dependent rollout while unrelated safe classes may continue.

#### Scenario: Canary cannot reload rotated secret

- **WHEN** a runtime-class canary fails reload or authorization verification
- **THEN** its configuration automatically rolls back, the remaining class batch is not admitted, and the previous credential remains recoverable
