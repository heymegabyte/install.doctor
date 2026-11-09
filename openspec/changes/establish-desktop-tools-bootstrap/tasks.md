# Tasks

## 1. Product identity and capability truth

- [x] 1.1 Define the canonical Desktop Tools product, package, executable, environment-variable, state-directory, domain, and legacy-name mapping in one strict registry; verify schema validation rejects duplicate, ambiguous, or unowned names.
- [x] 1.2 Generate user-facing capability and migration status from the registry rather than contradictory ledgers; verify repository docs and hosted capability claims cannot mark contract-only behavior as live.
- [x] 1.3 Add additive compatibility shims for supported Install Doctor and aid commands/state without moving or deleting user data; verify legacy fixtures produce deterministic migration previews and unchanged reapplication.
- [x] 1.4 Update product-boundary documentation and operating guidance for Desktop Tools while preserving historical attribution; verify documentation tests reject the retired two-product architecture.

## 2. Profile model and wildcard routing

- [x] 2.1 Extend the strict versioned `ENVIRONMENT.md` model with Desktop Tools profile identity, revision, visibility, prompt policy, and secret references; verify lossless import/export, explicit migration, and stable digests.
- [x] 2.2 Implement reserved-name-aware profile slug validation and tenant-scoped profile resolution; verify unknown, disabled, cross-tenant, Unicode-confusable, oversized, and malformed slugs fail closed.
- [x] 2.3 Add wildcard `*.desktop.tools` routing and TLS/DNS deployment configuration without activating enrollment; verify `example.desktop.tools` resolves only `example` and apex/reserved hosts retain their explicit routes.
- [x] 2.4 Serve a bounded cache-controlled public profile descriptor containing no credentials, private inventory, secret values, or enrollment authority; verify adversarial response and log scans remain secret-free.
- [x] 2.5 Document profile creation, portable export, standalone use, disablement, and recovery; verify all published commands use the profile-subdomain form exactly.

## 3. Signed stage-zero and release activation

- [x] 3.1 Adapt the signed release manifest and trust policy to Desktop Tools naming while preserving source/release provenance and rollback protection; verify legacy trusted releases remain independently verifiable during migration.
- [x] 3.2 Implement the minimal profile-subdomain stage-zero launcher with private staging, bounded HTTPS/origin/redirect/size/time policy, immutable verification, cleanup, and no mutable fallback; verify tampering, expiry, wrong origin, redirect, oversize, truncation, and verifier failure execute nothing.
- [x] 3.3 Package a pinned supported OpenCode runtime and Desktop Tools supervisor/tools in the signed release closure; verify exact hashes, SBOM, provenance, licenses, and offline verification for every selected platform artifact.
- [ ] 3.4 Provision the protected production signer and immutable release publication boundary, activate one canary release through compare-and-swap, and verify the private key is absent from builders, publishers, logs, and targets.
- [ ] 3.5 Verify `curl -fsSL https://example.desktop.tools | bash` reaches the signed launcher on a disposable target while an unknown profile and unavailable release channel fail closed.

## 4. Cross-device authorization

- [x] 4.1 Introduce strict authorization request, approval, poll, claim, denial, revocation, and audit schemas bound to tenant, profile, target public key, fingerprint, scopes, nonce, and expiry; verify unknown fields and scope broadening are rejected.
- [x] 4.2 Implement target-generated key material, protected polling state, human code, approval URI, bounded poll interval, cancellation, and restart-safe resume; verify secrets never appear in arguments, terminal output, Markdown, or telemetry.
- [x] 4.3 Implement authenticated owner approval displaying the matching code, machine fingerprint, profile revision, scopes, actor, and expiry; verify approve, deny, stale revision, wrong actor, and reauthentication paths.
- [x] 4.4 Implement one-time atomic credential claim with minimum device scopes, finite lifetime, independent revocation, and normalized privacy-preserving errors; verify replay, collision, cross-device, cross-profile, cross-tenant, expired, denied, and over-polling attempts fail.
- [x] 4.5 Complete the Cloudflare-first OIDC callback/session path for ordinary approval and keep token entry only as labelled audited break-glass access; verify a real owner session completes enrollment without a pasted admin token.
- [x] 4.6 Document headless enrollment, phishing-resistant code comparison, denial, timeout, revocation, and recovery; verify the instructions work from a machine with no browser or graphical session.
- [x] 4.7 Implement the dedicated online Ed25519 broker-approval signing boundary backed by durable authenticated owner-decision, run-intent, immutable profile revision, device identity, and exact-plan state; make the server reconstruct rather than trust the submitted grant; verify signer isolation, minimum scope, exact binding, denial, expiry, replay, cross-tenant/profile/device/run substitution, rotation overlap, emergency revocation, and audit correlation without exporting the private key.

## 5. OpenCode supervisor and provisioning boundary

- [x] 5.1 Implement a least-privilege local supervisor that binds OpenCode privately, validates the pinned runtime, creates protected state, and survives target restart; verify no public listener or unrestricted shell is exposed.
- [x] 5.2 Generate a strict Desktop Tools OpenCode configuration with scoped inference credentials, approved provider routes, pinned on-demand skills, denied external directories, and task-specific tool permissions; verify unrelated inherited secrets and ambient provider credentials are absent.
- [x] 5.3 Define and version the provisioning prompt that binds the profile revision, release, discovered facts, policy, capabilities, and permitted tools; verify prompt and context digests are recorded before execution.
- [x] 5.4 Expose discover, validate, plan, approve, apply, verify, status, resume, rollback-config, and deprovision-preview only through strict typed tool adapters; verify model-generated text or shell cannot bypass engine schemas, consent, locks, or journal ownership.
- [ ] 5.5 Cut remaining selected bootstrap, Installx, service, privilege, and configuration mutations into installer-engine tasks in bounded vertical slices; verify each migrated effect has preconditions, postconditions, interruption recovery, and an unchanged no-op run before retiring its legacy writer.
  - [x] 5.5.a Migrate bootstrap Installx directory and file materialization to native managed operations with protected source validation, durable compensation, rollback, unchanged inode/timestamp no-op evidence, and preservation of the untouched legacy home path.
  - [x] 5.5.b Migrate installer-owned sudo credential revocation to a native run finalizer bound to an approved fixed root-owned setuid executable identity, exact argv and environment, preexisting-authority preservation, interruption reconciliation, and durable finalizer evidence without a competing shell writer.
- [x] 5.5.c Cut Debian 12 amd64 `tree=2.1.0-1` into a release-bound native dpkg task with exact signed repository and payload authority; exact `Codename: bookworm` and `Suite: oldstable` binding; signed `Date` freshness using exact `Valid-Until` when present or explicit absence plus the signed 180-day composition-age bound and current seven-day Desktop Tools release when absent; a non-mutating `libc6 (>= 2.34)` installed dependency witness; online/offline plan parity; network-denied execution; selection subtraction from Installx only after admission; interruption reconciliation; explicit non-rollback limits; and unchanged no-op evidence. Retain every other package on the legacy path, reject silent suite aliases or transitions, and never disable time or expiry checks.
    - [x] 5.5.c.1 Add release-builder-only Debian acquisition and composition using a source-owned pinned archive-keyring trust policy; verify the exact keyring, InRelease, Packages index, and `tree` payload chain; stage the generated catalog descriptor; and introduce a versioned next-schema immutable release closure whose manifest, exact publication allowlist, SBOM, provenance, freshness, and read-back cover all four objects while preserving published schema-v7 inspection.
    - [x] 5.5.c.2 Preserve the admitted native descriptor through load-plan and implement one engine-owned native-package composition seam plus one shared online/offline artifact materializer and runtime adapter; verify both transports enforce identical authority, produce identical task, operation, and plan digests, and execute without apt, target mirror access, ambient keyrings, or apply-time network.
- [x] 5.5.c.3 Implement the bounded release-pinned root-owned native-package broker and root-to-user execution split: preserve exactly one enrolled-user-owned approved plan and canonical journal; execute user tasks only as that user; convert explicit local approval or release-root-delegated signed-device approval into an exact-plan root-protected execution grant; deliver the strict signer delegation through the immutable verified release closure and root-owned sealed authority handoff; derive trust at root without caller-controlled environment, stdin key, profile value, key id, epoch, or path authority; independently verify delegation scope, signature, validity, rotation/revocation epoch, approval expiry, owner-decision/profile/device/audit bindings, and exact grant; dispatch only exact granted admin operations through a strict enrolled-peer-checked envelope; transfer payloads only as verified sealed anonymous descriptors; bind grants, root transaction fences, and receipts to host/release/run/plan/task/operation/phase/consent/descriptor/nonces; and perform dpkg plus policy, quiescence, service, fence, and recovery work only after proving a distinct network namespace. Then prove end-to-end release publication, lazy online materialization, offline export, explicit offline local approval without silent downgrade, native check/apply/verify, crash-window resume, endpoint-without-grant denial, caller-trust substitution denial, rotated/revoked/stale signer denial, broker-bypass denial, interruption reconciliation, terminal broker cleanup, retained historical-evidence verification, and unchanged no-op behavior on the supported Debian cell; subtract only admitted `tree` from Installx, retain unsupported packages before admission, and fail closed without sudo-shell, apt, target-mirror, ambient-keyring, second-plan, legacy-writer, hosted-to-local approval fallback, or apply-time-network fallback after native admission.
- [x] 5.6 Preserve a deterministic non-AI and offline path for complete supported plans; verify provider outage cannot fabricate failure recovery or force a cloud-model dependency into bootstrap.

## 6. Session evidence, terminal behavior, and privacy

- [x] 6.1 Persist History and recording headers before PTY or OpenCode launch with profile, machine, actor, authorization, release, prompt, runtime, skills, tools, and parent identifiers; verify evidence failure cannot be reported as complete capture.
- [x] 6.2 Correlate child agents, approvals, plans, diffs, events, costs, output gaps, verification, cancellation, and terminal status through one bounded event protocol; verify parallel output remains attributable and sequence gaps are detected.
- [x] 6.3 Add consented sanitized asciicast v3 output, resize, marker, and exit recording with encrypted storage, retention, deletion, export, and visible incomplete-capture states; verify raw keyboard input and excess environment values are excluded by default.
- [x] 6.4 Implement detach/reconnect/stop semantics and bounded flow control for future browser terminals without making the edge coordinator a PTY host; verify tab loss does not kill the run and explicit stop remains separately authorized.

## 7. Portability, recovery, and lifecycle

- [x] 7.1 Export each Desktop Tools profile and immutable recipe references without credentials or private machine data; verify a fresh standalone target produces the same plan digest from the export.
- [x] 7.2 Build a signed offline bundle for the canary profile and platform, then verify network-denied plan/apply/verify and explicit missing-secret remediation.
- [x] 7.3 Add safe ownership-aware adoption and deprovision behavior for existing machines; verify user data, modified files, unowned resources, and unsupported effects are preserved.
- [x] 7.4 Exercise credential renewal, profile revision, device revocation, rebuild, signer rotation, bad-release rollback, and hosted-service outage; verify historical recovery material remains usable where retained evidence depends on it.

## 8. Canary promotion and integration evidence

- [x] 8.1 Run focused strict TypeScript, schema, auth, profile, release, engine, terminal, secret, and documentation suites for each preceding group and resolve introduced regressions without weakening gates.
- [ ] 8.2 Complete one disposable headless platform lifecycle from profile URL through approval, OpenCode launch, plan, apply, verify, unchanged rerun, interruption/resume, rollback, and deprovision preview; publish a redacted signed receipt bound to the release and platform cell.
- [ ] 8.3 Verify denial, expiry, replay, profile-race, provider outage, hosted-service outage, recording failure, telemetry timeout, and rollback scenarios on the canary without mutating unrelated hosts.
- [ ] 8.4 Run the full repository suite, generated-artifact drift checks, secret scans, action validation, strict OpenSpec validation, and independent promotion verification; record failures and external blockers without converting them to success.
- [ ] 8.5 Promote Desktop Tools documentation and the wildcard bootstrap only after the canary evidence is current, retain legacy compatibility for the declared window, and verify rollback restores the previous routing without deleting user state.

## Workflow follow-up

- Synchronize the accepted delta specifications into the durable specs after implementation verification.
- Archive the change only after production activation, canary evidence, compatibility evidence, and review requirements are satisfied.
