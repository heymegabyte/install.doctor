# Spec Delta

## MODIFIED Requirements

### Requirement: Safe curl-pipe entrypoint
The root of a valid Desktop Tools profile subdomain SHALL stream a bounded stage-zero launcher that downloads the provisioner into a private temporary directory and executes the verified local file, SHALL NOT use process substitution, and SHALL use `/dev/null` as target stdin while cross-device authorization is pending.

#### Scenario: Interactive invocation
- **WHEN** a user runs `curl -fsSL https://example.desktop.tools | bash`
- **THEN** the launcher resolves the `example` profile, verifies the release, and starts headless-capable device authorization

#### Scenario: Headless invocation
- **WHEN** no terminal or graphical session is available
- **THEN** the launcher remains operable through another device's approval and supplies `/dev/null` to unattended subprocesses

#### Scenario: Direct interactive terminal
- **WHEN** an operator explicitly selects a supported local interactive recovery action
- **THEN** only that action may reconnect input to `/dev/tty` after the script stream has been fully separated from command input

### Requirement: Bounded execution
Independent installer tasks SHALL start only through a bounded worker queue. Package-manager and privileged mutations SHALL be serialized per shared lock domain, model-generated text SHALL NOT create execution authority, and any task failure SHALL produce a non-zero result.

#### Scenario: Concurrent install
- **WHEN** more tasks are ready than the configured worker limit
- **THEN** no more than the configured number start and failures are reported

#### Scenario: Agent requests unauthorized effect
- **WHEN** the provisioning agent requests an effect outside the approved typed task graph
- **THEN** the effect is rejected without mutation

### Requirement: Plan before mutation
Interactive and headless runs SHALL resolve the profile revision, role, capabilities, network actions, secrets references, consents, permissions, and concurrency into a durable plan before applying system changes.

#### Scenario: Headless plan
- **WHEN** a Desktop Tools profile selects a headless role and capabilities
- **THEN** a versioned plan bound to the profile, release, machine identity, prompt, and tool versions is persisted before approval or mutation

#### Scenario: Profile changes during approval
- **WHEN** the selected profile changes after the target plan was created
- **THEN** the stale plan cannot be applied and the target must present a new diff for approval

## ADDED Requirements

### Requirement: Release-bound native Debian package slices
Native Debian package cutovers SHALL derive mutation authority from exact signed release and Debian repository evidence, SHALL bind repository codename and suite phase independently, SHALL enforce bounded signed-metadata freshness whether or not the repository supplies `Valid-Until`, SHALL preserve online/offline plan parity, and SHALL retain unsupported packages on the legacy path until separately verified.

#### Scenario: First supported package slice
- **WHEN** a Debian 12 bookworm amd64 target selects `tree`
- **THEN** the plan contains one native task for exact package `tree=2.1.0-1`, bound to signed repository metadata and payload authority, plus a non-mutating installed witness proving `libc6 (>= 2.34)`

#### Scenario: Online and offline parity
- **WHEN** the same profile, host facts, release, catalog, and package artifacts are planned online and from an offline bundle
- **THEN** both paths produce the same native task and plan digest and execute package mutation without network access

#### Scenario: Repository metadata supplies Valid-Until
- **WHEN** the signed InRelease supplies `Valid-Until`
- **THEN** the descriptor binds its exact value and execution is rejected at or after the earlier of that value and the signed Desktop Tools release expiry

#### Scenario: Repository metadata omits Valid-Until
- **WHEN** the signed `Codename: bookworm`, `Suite: oldstable` InRelease omits `Valid-Until`
- **THEN** the descriptor binds that absence, the signed `Date` is no more than 180 days older than Desktop Tools release creation and no more than 10 seconds in the future, and execution is accepted only while the independently signed Desktop Tools release remains within its seven-day validity window

#### Scenario: Debian suite phase changes
- **WHEN** signed repository metadata no longer has both exact `Codename: bookworm` and exact `Suite: oldstable`
- **THEN** the existing descriptor and plan are rejected and the new phase requires newly reviewed and signed Desktop Tools release authority

#### Scenario: Trusted release composition
- **WHEN** the release builder composes the native `tree` slice
- **THEN** a source-owned policy pins the archive-keyring digest, permitted signing fingerprints, origin, and exact repository paths, and the builder verifies the bounded keyring, InRelease, Packages index, package stanza, payload, control metadata, and freshness chain before staging one canonical catalog descriptor

#### Scenario: Immutable release closure expands
- **WHEN** the four Debian proof and payload objects are admitted to a Desktop Tools release
- **THEN** a versioned next-schema manifest and exact publication allowlist bind every object URL, digest, and size, the SBOM and provenance cover the complete expanded closure and source trust policy, immutable publication is read back, and previously published schema-v7 releases retain their original inspection contract

#### Scenario: Release expiry is covered by repository authority
- **WHEN** an admitted InRelease contains `Valid-Until`
- **THEN** the Desktop Tools release expiry is no later than `Valid-Until`

#### Scenario: Selected native authority survives load planning
- **WHEN** load-plan admits the native `tree` descriptor
- **THEN** the complete descriptor reaches one engine-owned native-package composer that derives the check, apply, and verify operations without transport-specific plan semantics

#### Scenario: Shared native materialization
- **WHEN** the native artifacts are resolved from the immutable online release namespace or an offline bundle
- **THEN** one materializer enforces the same identifiers, bytes, digests, sizes, and boundaries and supplies protected handles to one runtime adapter, producing identical task, operation, and plan digests without apt, ambient keyrings, target mirror access, or apply-time network

#### Scenario: Native artifacts remain lazy
- **WHEN** a bootstrap does not select the native `tree` slice
- **THEN** it does not acquire the four Debian objects, while an offline export selecting the slice contains the identical signed objects and authority

#### Scenario: Package authority is incomplete or incompatible
- **WHEN** libc6 is missing, unhealthy, held at an incompatible version, or has an incompatible architecture, or the target has the wrong distribution or architecture, or repository metadata is expired, future-dated beyond tolerance, forged, ambiguously missing freshness state, outside the signed composition-age bound, or bound to a different suite or codename, or a payload digest differs
- **THEN** the native package task is rejected before mutation

#### Scenario: Bounded selection cutover
- **WHEN** the native tree task is fully admitted
- **THEN** only `tree` is removed from the legacy Installx package selection and every unsupported package remains on the legacy path

#### Scenario: Native authority fails after admission
- **WHEN** admitted native authority is later missing, substituted, malformed, or not executable
- **THEN** execution fails closed with durable evidence and does not silently invoke the legacy writer

#### Scenario: Interrupted package mutation
- **WHEN** execution is interrupted after dpkg state changes
- **THEN** the engine reconciles the exact observed state, restores package policy and service guards, and reports a resumable or blocked outcome without automatic removal, downgrade, global configure, or a false rollback claim

#### Scenario: Unchanged package rerun
- **WHEN** the exact tree version and dependency witness already satisfy the approved task
- **THEN** the rerun verifies without package mutation or duplicate recovery work
