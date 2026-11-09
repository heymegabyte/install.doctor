# Design

**Architect Role:** assigned

## Context

See `proposal.md` for motivation. The repository currently combines a mature cross-platform desired-state tree, a partially integrated installer engine, an aid-core contract package, and a live Cloudflare control-plane skeleton. The public `/start` route fails closed because no trusted stable release is active; real device mutation is intentionally unavailable from the server. Pairing, signed-release publication, environment schemas, event rendering, and OpenCode-oriented contracts exist at different maturity levels.

The change crosses naming, DNS, release trust, enrollment, authorization, OpenCode startup, mutation authority, portable configuration, evidence, and migration. It must preserve existing user files and working provisioning paths until verified replacements exist. A full SaaS visual redesign remains separately gated by approved design work.

## Goals / Non-Goals

**Goals:**

- Deliver the exact `curl -fsSL https://<profile>.desktop.tools | bash` contract for graphical and headless targets.
- Make the profile subdomain permanent and shareable without treating it as a credential.
- Require explicit cross-device approval before a new machine receives scoped authority.
- Launch a pinned OpenCode runtime with a versioned provisioning prompt and minimum capabilities.
- Keep deterministic planning, mutation, journaling, rollback, and verification in the installer engine.
- Preserve portable profiles and a standalone recovery path independent of the hosted service.
- Migrate existing Install Doctor and aid state without destructive renames or false capability claims.

**Non-Goals:**

- Exposing OpenCode's programmatic server directly to the Internet.
- Giving a language model unrestricted shell, root, secret, filesystem, or network access.
- Encoding enrollment credentials or secrets in profile names, DNS, HTML, or stage zero.
- Replacing all existing mutation paths before parity and real-host evidence exist.
- Implementing the final visual Desktop Tools application without approved designs.
- Making paid AI inference a prerequisite for deterministic provisioning or recovery.

## Decisions

### 1. Wildcard subdomains identify profiles, not principals

Cloudflare wildcard DNS and TLS route `<profile>.desktop.tools` to one bootstrap handler. The handler validates a normalized, reserved-name-aware profile slug and resolves a versioned public profile descriptor; authorization later binds the run to one immutable profile revision and digest. Tenant and owner identity come only from authenticated server state during approval.

Alternative: make an unguessable subdomain a bearer secret. Rejected because URLs leak through shell history, DNS, logs, proxies, support transcripts, and copy/paste.

### 2. The root response is a minimal stage-zero script

The endpoint returns a cache-controlled shell launcher containing only the profile identifier, trusted public roots, bounded fetch policy, and release-channel bootstrap logic. It downloads into a private temporary directory, verifies before execution, and never falls back to a moving branch or inline mutable implementation.

Alternative: embed the entire provisioner and configuration in the response. Rejected because it increases the unauthenticated attack surface and makes independent signing, offline reuse, rollback, and provenance verification harder.

### 3. Device authorization uses a separate approval device

The target generates its key material and private polling secret locally, starts a bounded authorization request, and displays a human code plus approval URI. The owner signs in on another device and sees the matching code, device fingerprint, profile, requested scopes, and expiry. Approval permits one atomic claim of a short-lived, device-bound credential.

The protocol follows device-authorization properties without depending on the profile URL as authority. Polling uses interval guidance, bounded retries, normalized errors, replay denial, and no controller-store fallback.

Enrollment approval and privileged-run approval are separate authorities. After an authenticated owner approves enrollment, a dedicated online `desktop-tools-broker-approval-v1` Ed25519 signer may authorize one exact broker grant only after the approval service reconstructs the grant projection from durable owner-decision, run-intent, profile, device, and plan state. It does not sign a caller-supplied arbitrary grant. The approval binds tenant, profile identifier and immutable revision digest, device credential and fingerprint, authorization and owner-decision audit identifiers, host, release, run, approved plan, enrolled UID, broker/runtime/worker identities, descriptor, closure, consent, operations, delegation digest and epoch, approval time, and approval expiry. The signer is distinct from the release signer, device-credential signer, and tenant/profile keys. Its private key never reaches a target or release builder and production custody uses a non-exportable managed signing boundary where available.

The protected release root delegates the online approval signer through a strict immutable `BrokerApprovalSignerDelegation` in the signed release closure. The delegation binds its unique key identifier and Ed25519 SPKI public key, signature domain, product, release/channel scope, validity interval, maximum grant and approval lifetime, and revocation epoch. Rotation publishes a newly signed closure containing a bounded overlap of old and new delegations with distinct key identifiers and key material. Root accepts new approval evidence only from a delegation in the currently verified release, within both delegation and grant lifetimes, and at or above the release-bound minimum revocation epoch. Emergency revocation activates a newly signed release/channel state with a higher minimum epoch; already running grants are not extended and remain bounded to thirty minutes. Historical delegations may remain available to verify retained evidence but cannot mint or authorize fresh work.

Alternative: require target-browser OAuth. Rejected because headless machines are first-class. Alternative: unattended permanent profile credentials. Rejected because compromise would authorize unlimited machines.

### 4. OpenCode is pinned and private

The verified release supplies a pinned OpenCode distribution exposed as the `desktop-tools` executable and a Desktop Tools configuration that binds its server locally. The supervisor starts it with a minimized environment, scoped session token, selected skills, exact prompt version, and typed Desktop Tools tools. Customer-facing provider access uses the shared ProjectSites routing boundary, prefers DeepSeek, does not introduce LiteLLM, and uses a short-lived inference credential distinct from device/control-plane authority.

Alternative: expose `opencode serve` through the public Worker. Rejected because the control plane must mediate authorization, tenancy, capability grants, and evidence.

### 5. The agent orchestrates; the engine mutates

The prompt asks OpenCode to discover, explain, plan, request approval, invoke tools, verify, and report. Every state-changing tool compiles to the installer engine's strict task schema and plan digest. The engine owns locks, privilege brokering, secrets delivery, journal fencing, retries, compensation, verification, and terminal status. Free-form shell remains read-only or denied unless represented by an explicitly approved typed capability.

The canonical engine runs as the enrolled non-root user for discovery, planning, approval, scheduling, user effects, and the sole orchestration journal. A root launch may verify the release, validate enrollment, and seal the handoff, but it must not execute the complete approved graph before dropping privilege. The user engine creates and persists exactly one plan and approval; it dispatches `privilege: user` tasks locally and may dispatch only an operation already present in that plan as `privilege: admin` to a narrow privileged broker. Root is an operation executor, never a second planner or scheduler.

For the supported Debian native-package slice, the broker is a signed-release-pinned, root-owned executable exposed only for the bounded run through a root-owned, local Unix `SOCK_SEQPACKET` endpoint with exact enrolled-UID peer-credential checks; it is removed at terminal cleanup and is not a general fleet daemon. Its service policy grants no shell, caller-selected executable, path, argv, environment, package, or network authority. After the user engine persists the plan and an explicit local or device approval, the broker independently validates the complete plan projection and approval evidence and records one root-protected, plan-digest-bound execution grant; merely possessing the endpoint or running as the enrolled UID cannot create or broaden that grant. A request is a strict, size-bounded envelope binding schema version, release and host identity, run id, approved plan digest, grant id, task id and digest, operation id and digest, phase, consent receipt, descriptor/closure digest, and a single-use request nonce. The broker recomputes all bindings, checks that the operation is selected and `privilege: admin`, rejects unknown fields and replay, and returns a strict receipt bound to the same identities. It receives package bytes only as a sealed anonymous file descriptor over `SCM_RIGHTS`; it verifies regular anonymous-file identity, required write/grow/shrink/seal seals, exact size, and SHA-256 before use and never accepts a payload path. Online and offline materializers therefore terminate at the same handle boundary.

For signed-device approval, the root coordinator derives trust only from the verified release closure. Stage zero materializes the exact signer delegation as a root-owned immutable authority artifact under the existing `/run/desktop-tools/authority/` handoff, binds its digest into the sealed root-to-user handoff and broker execution authority, and gives the coordinator only a fixed derived descriptor. Root opens the artifact without following links, validates ownership, mode, inode stability, digest, release-root signature, scope, validity, and revocation epoch, then pins the opened descriptor. The user coordinator may provide signed approval evidence, but no environment variable, stdin field, profile value, caller-selected path, key identifier, public key, or minimum revocation epoch may establish or broaden approval trust. Root independently recomputes the grant, approval, delegation, and execution-authority digests before publishing the grant.

The user-owned journal remains authoritative for orchestration, approval, scheduling, and terminal status. The broker's root-protected state is limited to the execution grant and a native-transaction fence keyed by host, release, approved plan, run, task, operation, phase, and payload digest so a crash between dpkg mutation and receipt cannot cause a blind replay. Resume first reconciles that fence and exact observed dpkg/policy/service state, then returns an idempotent completed, resumable, or blocked receipt for the user journal to record; the broker cannot select a new task, expand the grant, or mutate the user journal. Requests for the same operation are serialized under the engine lock domain and the root fence.

The broker performs dpkg query/mutation and all associated policy, service-quiescence, fence, and recovery work inside a newly created network namespace whose identity is proven distinct from the parent before mutation. It receives no network-capable descriptor, proxy variable, ambient keyring, apt configuration authority, or target-mirror authority. Failure to create or prove the namespace, validate the sealed payload, bind the request to the approved plan, establish the root fence, or reconcile prior state fails closed before a new mutation. Check and verify may use the same broker contract where root observation is required; no admin operation falls back to ambient sudo shell execution.

Alternative: permit the model to execute provisioning shell commands directly. Rejected because model text is neither authorization nor durable desired state.

Alternative: execute the entire engine as root and drop privilege inside individual user tasks. Rejected because parsers, orchestration, user paths, and unrelated tasks would inherit unnecessary root authority. Alternative: let the user engine call `sudo dpkg`, pass payload paths, or preserve arbitrary file descriptors through sudo. Rejected because those interfaces broaden command, path, environment, and descriptor authority and cannot provide one independently validated transaction boundary.

Signed-device broker approval is online-only by default. An offline bundle may carry the public delegation evidence needed to inspect historical signatures, but it carries no approval signing secret and no reusable approval. A signed approval fetched before connectivity loss remains usable only for its exact already-approved grant and only until the earliest approval, grant, delegation, or release expiry; it cannot be renewed offline. Fully offline execution requires the operator to select the explicit trusted-local approval path, which records distinct evidence. A hosted outage never silently changes approval method or weakens the trust boundary.

### 6. Profile resolution produces one portable desired state

Desktop Tools stores a versioned profile model and exports it as the repository's canonical `ENVIRONMENT.md` format. Hosted state contains secret references, not secret values. The approved machine receives the exact nonsecret revision plus only the minimum resolved secrets needed for the current plan. Exported profiles and signed offline bundles support recovery without Desktop Tools.

Alternative: generate a bespoke shell script per profile. Rejected because it destroys declarative diffs, portability, idempotency, and cross-platform validation.

### 7. Sessions and evidence exist before agent launch

Authorization creates a run intent, but the supervisor must durably persist History and recording headers before starting the PTY or agent. All events correlate profile revision, release, machine, actor, authorization, prompt, OpenCode version, skills, tool versions, plan, approvals, output gaps, costs, and verification. Recording output is consented and sanitized before remote persistence; raw keyboard input is excluded by default.

### 8. Migration is additive and evidence-gated

Desktop Tools initially ships alongside existing paths. Compatibility shims recognize legacy commands, environment variables, state directories, and profile files; they preserve data and emit deterministic migration plans. Public branding and default URLs switch only after signed bootstrap activation, one verified platform cell, device authorization, and a complete agent-to-engine canary pass. Legacy removal requires a separately documented deadline and telemetry/evidence showing safe migration.

### 9. The first native Debian package slice is release-bound `tree` on Debian 12 amd64

The first package cutover selects only catalog package `tree` when observed facts prove Debian 12/bookworm, amd64, and a supported dpkg runtime. It pins root package `tree=2.1.0-1`, whose admitted Debian relationship is only `libc6 (>= 2.34)`. Release authority must bind the signed Desktop Tools catalog to the Debian archive keyring fingerprint, a signed InRelease, the exact Packages index stanza, and the exact `.deb` SHA-256, size, and control metadata. The repository path and target identity are codename-bound to `bookworm`, while the signed metadata descriptor must also bind `Codename: bookworm` and the exact current phase `Suite: oldstable`. A suite transition, including `stable` to `oldstable`, invalidates the descriptor and requires a newly signed Desktop Tools release and plan; aliases are never accepted interchangeably.

Repository freshness remains mandatory even though Debian defines `Valid-Until` as optional and the current bookworm InRelease omits it. The signed descriptor must bind the InRelease `Date` and either the exact `Valid-Until` value or its explicit absence. A release dated more than 10 seconds in the future is rejected. When `Valid-Until` is present, both composition and execution must precede it, and effective expiry is the earlier of `Valid-Until` and the signed Desktop Tools release expiry. When it is absent, the signed release policy for this exact `oldstable`/`bookworm` slice must set `maximumDateAgeSeconds: 15552000` (180 days); the InRelease age is checked against the Desktop Tools release creation time, and execution is permitted only while that independently signed Desktop Tools release remains valid under its existing maximum seven-day lifetime. Thus a recent Desktop Tools release explicitly re-attests immutable Debian metadata rather than treating it as perpetually fresh. The mode, bound, `Date`, and explicit `Valid-Until` presence or absence are part of signed authority and the plan digest, not caller, environment, or profile overrides. No path disables time or expiry checks.

Debian acquisition and composition occur only inside the trusted release builder. A trust-policy file owned by the source commit pins the Debian archive-keyring artifact digest, permitted signing-key fingerprints, repository origin, and exact `bookworm` InRelease, Packages, and payload paths. The composer acquires exactly four bounded inputs—the pinned archive keyring, InRelease, exact Packages index, and `tree` `.deb`—then verifies the keyring-to-InRelease signature, InRelease-to-Packages digest and size, exact package stanza, payload digest and size, control metadata, and freshness before emitting one canonical native payload descriptor. Ambient host keyrings, apt state, live target mirrors, and caller-provided trust roots are not authority.

Published schema-v7 releases retain their original exact key set and remain inspectable for rollback; the four-object expansion uses the next manifest schema rather than silently redefining v7. Its exact manifest and publication allowlist bind URL, digest, and size for all four Debian objects. The composer output is merged into a staged catalog before signing, the SBOM covers every added release object, and provenance binds each upstream URI and digest, the source trust-policy digest, and the composition result. Publication stays create-only with immutable read-back verification. When InRelease contains `Valid-Until`, the complete Desktop Tools release window must end no later than that value. Debian objects are not downloaded by every bootstrap: online preparation lazily reads them from the verified immutable release namespace only when this slice is selected, while offline export carries the identical objects and authority.

`libc6` is a typed `preexisting-witness` dependency, not part of the mutation closure. The engine must observe a healthy installed dpkg identity, version, and architecture that satisfies the signed relationship before admitting the plan. It must not download, select, reinstall, upgrade, downgrade, or otherwise mutate `libc6`.

Online and offline execution use the same descriptor, composition seam, task, and operations. Load-plan selection must preserve the complete admitted native descriptor rather than projecting it away. One engine-owned native-package composer derives check, apply, and verify operations independently of transport. A shared materializer resolves descriptor artifact identifiers from either the verified immutable online release namespace or the verified offline bundle, enforces identical byte, digest, size, and boundary checks, and passes protected handles to one native-package runtime adapter. Target execution never consults Debian mirrors or apt, and apply remains network-denied in both modes. The same semantic inputs must yield identical task, operation, and plan digests.

The runtime adapter does not imply that the whole engine has root authority. On the supported cell it bridges the approved admin operation to the broker contract above, transfers the sealed payload handle, and records the broker receipt in the existing user-owned run journal. The bootstrap must preserve the verified release and catalog through the root-to-user handoff, then plan and journal under the enrolled user; it must not plan one graph as root and silently construct another after handoff. Privileged and user-owned operations remain nodes of that one approved graph even though they execute on opposite sides of the broker boundary.

Selection subtracts only `tree` from the legacy Installx package set after the descriptor is admitted and the native operations are executable. Missing or inapplicable signed authority leaves the package on its legacy path before approval; malformed, substituted, or unavailable authority after native admission fails closed and cannot silently fall back to a different writer. Every other package remains on its existing path.

The first slice makes no generic package rollback claim. Failure before unpack is a no-op. Interruption or failure after dpkg mutation must reconcile exact dpkg state, restore policy and service guards, and remain resumable or explicitly blocked with durable evidence. It must never auto-remove or downgrade packages, invoke global `dpkg --configure -a`, or report a configuration rollback for package state.

Alternative: include `libc6` in the mutable payload closure. Rejected because proving a small leaf-package cutover does not justify reinstalling or changing a foundational runtime library. Alternative: let apt resolve a live repository during apply. Rejected because it breaks exact plan authority, online/offline parity, and network-denied execution.

## Risks / Trade-offs

- **Wildcard profile enumeration or reserved-name capture** -> Normalize slugs, reserve infrastructure names, rate-limit lookups, return privacy-equivalent failures, and never expose private profile metadata publicly.
- **`curl | bash` obscures trust to users** -> Keep stage zero tiny and inspectable, publish verification instructions and hashes, verify before execution, and support download-then-run/offline alternatives.
- **Cross-device phishing** -> Display and compare the human code, machine fingerprint, profile, requested scopes, and actor on both surfaces; never auto-approve from a QR code alone.
- **Online approval-signer compromise or stale trust** -> Isolate a dedicated non-exportable signer, reconstruct grants from durable server state, use release-root-scoped short delegations and grant lifetimes, bind revocation epochs, rotate through signed overlap, and reject caller-supplied or stale trust at root.
- **OpenCode or model compromise** -> Pin provenance, isolate the server, minimize environment and permissions, require typed tools, and make the engine independently revalidate every plan and effect.
- **Hosted-service outage blocks first use** -> Preserve exported desired state, trusted releases, offline bundles, and local deterministic recovery paths.
- **Rename breaks existing users and automation** -> Use additive aliases, discovery-only migration, explicit state ownership, compatibility tests, and a bounded deprecation window.
- **Two product surfaces drift during migration** -> Generate capability/branding status from one registry and remove claims that lack live evidence.
- **Approval delays feel less automatic** -> Make target polling and resume durable; allow separately scoped one-time automation credentials later without weakening the default flow.

## Migration Plan

1. Introduce Desktop Tools naming, state schemas, slug rules, capability registry, and compatibility mappings without changing live defaults.
2. Activate a signed release containing the pinned OpenCode runtime, stage-zero verifier, supervisor boundary, and deterministic tools.
3. Add wildcard profile routing and public nonsecret descriptors while all enrollment remains disabled.
4. Enable cross-device authorization for a disposable tenant and verified canary machine.
5. Run a complete profile-to-OpenCode-to-engine lifecycle on one supported platform, including denial, expiry, interruption, unchanged rerun, rollback, and offline recovery.
6. Promote `*.desktop.tools` as the default documented path and retain legacy redirects/shims with deprecation telemetry.
7. Migrate existing user-controlled state only through previewed, reversible ownership-aware operations.
8. Remove legacy product surfaces only after the compatibility window and a separately approved removal gate.

Rollback at every phase restores the previous routing/default documentation and disables new enrollment. Activated signed releases and evidence remain append-only; rollback never deletes user configuration or historical verification material.
