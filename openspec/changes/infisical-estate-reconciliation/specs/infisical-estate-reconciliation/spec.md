# Infisical estate reconciliation

## ADDED Requirements

### Requirement: Deterministic least-privilege planning

The system SHALL derive explicit per-host and per-repository secret-name allowlists from declared capability groups and repository evidence before decrypting or writing any value.

#### Scenario: Broad workstation profile

- **WHEN** the macOS developer-workstation profile is planned
- **THEN** it includes relevant development, deployment, observability, communication, and infrastructure credentials
- **AND** excludes unrelated personal, recovery, licensing, and destructive administration credentials unless separately evidenced.

### Requirement: Complete source-identity inventory

The system SHALL inventory every encrypted source in the approved general, workstation, and WordPress stores under a stable store-qualified source identity without decrypting values.

#### Scenario: Same canonical name exists in multiple stores

- **WHEN** general, workstation, and WordPress stores each contain the same canonical secret name
- **THEN** discovery produces three distinct source identities with independent validation, mapping, destination, and retirement state

#### Scenario: Unsafe source entry is discovered

- **WHEN** an entry is a symlink, path escape, non-regular file, duplicate identity, undeclared store, or ambiguous collision
- **THEN** inventory fails before decryption or external mutation

### Requirement: Provider validation precedes use

Every source selected for migration or runtime use SHALL have a current `valid` metadata-only record from an approved provider-specific validator bound to the exact source identity, scope, environment, consumer, and plan.

#### Scenario: Validation is missing or inconclusive

- **WHEN** a selected source is missing validation or is unverified, stale, scope-mismatched, provider-unreachable, or provenance-incomplete
- **THEN** the complete apply is rejected before decryption and before any destination write

#### Scenario: Provider proves a credential invalid

- **WHEN** provider-specific validation proves the exact source invalid and listings show no required destination, consumer, or offline exception
- **THEN** it may enter reviewed `invalid-retired` state but cannot be migrated, used, or selected as fallback

### Requirement: Memory-only migration

The system SHALL decrypt only selected legacy values, pass them directly to an authenticated Infisical write operation, and avoid plaintext staging files and value-bearing logs.

#### Scenario: Selected value migration

- **WHEN** apply processes a selected encrypted template
- **THEN** the decrypted value is streamed directly to Infisical
- **AND** no plaintext staging file or value-bearing log is created.

### Requirement: Least-privilege source-to-target mapping

Each source identity SHALL declare its exact required host/workload destinations from synchronized least-privilege profiles, and WordPress sources SHALL map only to explicit WordPress/site workloads.

#### Scenario: Source has multiple required destinations

- **WHEN** a source is required by more than one authorized target
- **THEN** each destination is tracked independently and no broader host or workload receives the credential

#### Scenario: Profile references an unlisted source

- **WHEN** a profile, target, validation record, offline exception, or destination references an unknown or retired source identity
- **THEN** planning fails closed

### Requirement: Explicit WordPress workload isolation

The system SHALL select `secrets-wordpress` sources only for an explicitly declared WordPress/site workload with a dedicated Infisical project, dedicated non-human identity, exact project/root routing, exclusive source-store policy, and per-source allowlist. WordPress sources SHALL NOT enter host defaults, the general workload inventory, workstation overrides, Global compatibility paths, or unrelated workload projects.

#### Scenario: WordPress platform workload is selected

- **WHEN** `--workload wordpress-platform.megabyte.space` is selected
- **THEN** planning reads only the declared `secrets-wordpress` source identities and routes admitted sources to the workload's explicit dedicated project and root path
- **AND** it does not merge general or workstation sources

#### Scenario: Host or unrelated workload is selected

- **WHEN** any host, MCP workload, or non-WordPress workload is planned
- **THEN** all `secrets-wordpress` sources are excluded before validation, decryption, or destination access

### Requirement: WordPress consumer-bound project separation

The system SHALL treat an Infisical project and its dedicated identity as the authorization boundary for WordPress/site workloads. Sources consumed by different site identities or failure boundaries SHALL use separate explicit workload targets and dedicated projects rather than relying on paths within one shared project.

#### Scenario: Credential belongs to one site

- **WHEN** consumer evidence shows a WordPress source is required by only one site identity
- **THEN** planning requires that site's explicit workload/project and rejects placement in a shared platform grant

#### Scenario: Privileged bootstrap source is encountered

- **WHEN** `SUDO_PASSWORD` or another privileged bootstrap credential lacks a separately approved bootstrap/recovery workload contract
- **THEN** it remains blocked and is not granted to the steady-state WordPress application or platform identity

#### Scenario: Cross-target access is attempted

- **WHEN** a host, MCP, Global/legacy, or unrelated site identity requests a WordPress workload destination
- **THEN** authorization returns an explicit denial and no source metadata or value is disclosed

### Requirement: Scoped identities

The system SHALL use repository-and-environment-bound GitHub OIDC identities for CI and independently revocable host identities for host access.

#### Scenario: GitHub production workflow

- **WHEN** a production workflow requests repository secrets
- **THEN** authentication uses claims bound to that repository and production environment.

### Requirement: Controller-only Cloudflare Access SSH credentials

The system SHALL reserve every `CF_ACCESS_SSH_*_(CLIENT_ID|CLIENT_SECRET)` name from generic Cloudflare capability matching and SHALL admit the Coolify and Ubuntu client pairs only through an exact-name controller capability assigned to `macos.megabyte.space`. SSH destination hosts and unrelated workloads SHALL NOT receive the caller bearer credentials.

#### Scenario: macOS initiates non-interactive SSH

- **WHEN** the macOS controller profile resolves credentials for its Coolify or Ubuntu SSH proxy
- **THEN** the corresponding exact client ID and client secret pair is available from the dedicated macOS destination
- **AND** neither value appears in logs, argv, generated configuration, or durable proxy state

#### Scenario: Destination host is planned

- **WHEN** Ubuntu, Zen, Legion, or Omen is selected
- **THEN** all Cloudflare Access SSH client IDs and secrets are excluded despite any generic `CF_` or Cloudflare capability

#### Scenario: Broad pattern overlaps a reserved SSH name

- **WHEN** a generic capability regex matches a reserved Cloudflare Access SSH client name
- **THEN** deny-before-allow processing excludes it unless an exact reviewed controller capability re-admits it
- **AND** ambiguous overlap fails schema/profile compilation

#### Scenario: Omen lacks an explicit host declaration

- **WHEN** Omen is selected before its exact project, path, identity, and profile are declared
- **THEN** planning fails before validation, decryption, or destination access

#### Scenario: Another automation caller needs SSH

- **WHEN** a non-macOS runner needs non-interactive SSH
- **THEN** it requires a separate workload identity and per-caller Access token contract rather than inheriting or copying the macOS pair

### Requirement: Host-bounded WARP enrollment credentials

The system SHALL reserve `CLOUDFLARE_TEAMS_CLIENT_ID` and `CLOUDFLARE_TEAMS_CLIENT_SECRET` from generic Cloudflare matching and SHALL admit them only through a bounded WARP enrollment capability for macOS and Ubuntu. The workstation source SHALL route only to the dedicated macOS project and the general source SHALL route only to the dedicated Ubuntu project during transition.

#### Scenario: Identical source copies are planned

- **WHEN** the byte-identical general and workstation Teams sources are inventoried
- **THEN** their equivalence/override relation is recorded without collapsing source identity
- **AND** each retains its own host destination, validation, cutover, and retirement evidence

#### Scenario: Managed host requests Teams credentials

- **WHEN** Zen, Legion, Omen, MCP, WordPress, CI, or another non-enrollment profile is planned
- **THEN** both Teams sources are excluded before validation, decryption, or destination access

#### Scenario: Healthy WARP client starts

- **WHEN** macOS or Ubuntu is already registered and connected to the declared organization
- **THEN** normal startup does not retrieve the enrollment pair or require a readable installed MDM token file

#### Scenario: Enrollment or recovery is required

- **WHEN** the admitted host must enroll or recover WARP registration
- **THEN** the matching host identity retrieves the pair request-locally for the supported enrollment operation
- **AND** no token remains in a readable MDM file, argv, environment, log, generated client, or MCP descriptor

#### Scenario: Shared bootstrap token is replaced

- **WHEN** independently revocable macOS and Ubuntu enrollment tokens have each passed host-specific re-enrollment and health verification
- **THEN** the shared token becomes eligible for separately authorized policy removal and revocation
- **AND** one host's evidence cannot authorize the other host's cutover

### Requirement: Unused Origin CA key retirement

The system SHALL classify each general/workstation `CLOUDFLARE_ORIGIN_CA_KEY` source as `retirement-candidate` with an empty destination set while no executable certificate-issuance consumer is evidenced. The key SHALL NOT enter generic Cloudflare, macOS, host, or workload profiles.

#### Scenario: No Origin CA consumer exists

- **WHEN** provider-status inspection and synchronized consumer listings confirm no active required consumer
- **THEN** each exact source proceeds through the no-destination retirement assertion and deletion gates without migration

#### Scenario: Certificate-issuance consumer is discovered

- **WHEN** evidence identifies a current consumer before retirement
- **THEN** deletion and host migration are blocked
- **AND** architecture requires a dedicated certificate-issuance workload/project and newly scoped credential review

### Requirement: Application-bound Megabyte OS E2E credential

The system SHALL admit the general `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` pair only as the `megabyte-os-e2e` credential for macOS-run verification of the `Megabyte OS` Access application at `os.megabyte.space`. Generic environment-name reuse SHALL NOT authorize another application, host, workload, Worker, or MCP surface.

#### Scenario: MacOS E2E verification is planned

- **WHEN** the consumer metadata exactly matches the reviewed token, application, domain, and macOS runner
- **THEN** the pair is selected from the dedicated macOS project and injected request-locally into only the E2E process

#### Scenario: Another application uses generic variable names

- **WHEN** Mission/Listmonk, GitLab, project-sites, a Worker, or another consumer requests `CF_ACCESS_CLIENT_ID/SECRET`
- **THEN** the OS pair is rejected unless that consumer has its own separately mapped application-specific credential

#### Scenario: MCP automation requests Access credentials

- **WHEN** an MCP portal or automation client resolves its Access identity
- **THEN** it uses its distinct `MCP_AUTOMATION_CF_ACCESS_CLIENT_*` or approved runtime bindings and cannot fall back to the OS pair

#### Scenario: OS origin returns 522

- **WHEN** token metadata and policy membership are active but the protected origin returns `522`
- **THEN** validation remains blocked or unverified and cannot authorize migration apply, consumer cutover, or source retirement

#### Scenario: OS origin recovers

- **WHEN** a real authenticated E2E call succeeds after origin recovery
- **THEN** validation also requires anonymous denial and representative unrelated-application denial before status may become `valid`

### Requirement: Safe reconciliation

The system SHALL be idempotent, complete inventory before mutation, mask output, and perform no deletion, revocation, rotation, or permission widening outside the declared plan.

#### Scenario: Repeated reconciliation

- **WHEN** reconciliation is run again against unchanged desired state
- **THEN** it performs no destructive action and preserves the same scoped result.

### Requirement: Destination round-trip and target retrieval

A destination SHALL be complete only after exact Infisical write/read round trip, retrieval by the intended target host/workload identity, representative cross-target denial, real consumer cutover, and rollback evidence.

#### Scenario: Writer succeeds but target retrieval fails

- **WHEN** Infisical read-after-write succeeds for the writer but the intended target identity cannot retrieve or use the credential
- **THEN** the destination remains incomplete and the encrypted source remains present

### Requirement: Evidence-gated exact-source retirement

The system SHALL delete every in-scope encrypted source as the terminal migration step when every required destination and consumer is complete, the observation/fallback window has closed, rollback/recovery evidence exists, no technically required offline exception remains, and a reviewed assertion binds the exact current source identity and ciphertext drift digest. Evidence for one source SHALL NOT authorize deletion of another.

#### Scenario: All exact-source gates pass

- **WHEN** an encrypted source passes exact validation, every required destination round trip and target retrieval, consumer cutover, observation/recovery, offline-exception, and retirement-assertion gates
- **THEN** the system deletes that exact encrypted source and records value-free retirement evidence

#### Scenario: One destination remains incomplete

- **WHEN** any required destination lacks round-trip, target retrieval, consumer cutover, denial, or rollback evidence
- **THEN** deletion is rejected and the encrypted source remains unchanged

#### Scenario: Same-named source exists elsewhere

- **WHEN** one exact source is retirement-eligible but another store contains the same canonical name
- **THEN** retirement can affect only the asserted source identity

### Requirement: Explicit offline exceptions

Offline recovery exceptions SHALL bind exact source identities, owners, consumers, permitted hosts, review expiry, minimum recovery capability, current technical necessity, and executed value-free recovery evidence. A source SHALL be retained only while its exception remains technically required and cannot yet be replaced by validated recovery.

#### Scenario: Online cutover completes while exception is active

- **WHEN** all online destinations pass but the source remains an active offline exception
- **THEN** encrypted-source deletion is rejected until the exception is explicitly retired or replaced

#### Scenario: Exception is stale or convenience-only

- **WHEN** an offline exception is expired, no longer technically required, convenience-only, or superseded by validated recovery
- **THEN** it cannot preserve the encrypted source and must be retired before exact-source deletion proceeds

### Requirement: Profile and listing synchronization

The inventory listing, profiles, host/workload targets, validation ledger, destination evidence, offline exceptions, and retirement assertions SHALL form a deterministic closed set before planning or apply.

#### Scenario: New source is not classified

- **WHEN** discovery finds a source absent from synchronized profiles and disposition records
- **THEN** it defaults to blocked-unknown and cannot be selected

#### Scenario: Listing contains stale retirement state

- **WHEN** a retired/deleted source remains selectable or a removed source lacks a retirement assertion
- **THEN** synchronization fails and no secret is decrypted or written
