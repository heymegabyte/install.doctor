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
- [ ] 4.3 Implement authenticated owner approval displaying the matching code, machine fingerprint, profile revision, scopes, actor, and expiry; verify approve, deny, stale revision, wrong actor, and reauthentication paths.
- [ ] 4.4 Implement one-time atomic credential claim with minimum device scopes, finite lifetime, independent revocation, and normalized privacy-preserving errors; verify replay, collision, cross-device, cross-profile, cross-tenant, expired, denied, and over-polling attempts fail.
- [ ] 4.5 Complete the Cloudflare-first OIDC callback/session path for ordinary approval and keep token entry only as labelled audited break-glass access; verify a real owner session completes enrollment without a pasted admin token.
- [ ] 4.6 Document headless enrollment, phishing-resistant code comparison, denial, timeout, revocation, and recovery; verify the instructions work from a machine with no browser or graphical session.

## 5. OpenCode supervisor and provisioning boundary

- [x] 5.1 Implement a least-privilege local supervisor that binds OpenCode privately, validates the pinned runtime, creates protected state, and survives target restart; verify no public listener or unrestricted shell is exposed.
- [x] 5.2 Generate a strict Desktop Tools OpenCode configuration with scoped inference credentials, approved provider routes, pinned on-demand skills, denied external directories, and task-specific tool permissions; verify unrelated inherited secrets and ambient provider credentials are absent.
- [ ] 5.3 Define and version the provisioning prompt that binds the profile revision, release, discovered facts, policy, capabilities, and permitted tools; verify prompt and context digests are recorded before execution.
- [ ] 5.4 Expose discover, validate, plan, approve, apply, verify, status, resume, rollback-config, and deprovision-preview only through strict typed tool adapters; verify model-generated text or shell cannot bypass engine schemas, consent, locks, or journal ownership.
- [ ] 5.5 Cut remaining selected bootstrap, Installx, service, privilege, and configuration mutations into installer-engine tasks in bounded vertical slices; verify each migrated effect has preconditions, postconditions, interruption recovery, and an unchanged no-op run before retiring its legacy writer.
- [ ] 5.6 Preserve a deterministic non-AI and offline path for complete supported plans; verify provider outage cannot fabricate failure recovery or force a cloud-model dependency into bootstrap.

## 6. Session evidence, terminal behavior, and privacy

- [ ] 6.1 Persist History and recording headers before PTY or OpenCode launch with profile, machine, actor, authorization, release, prompt, runtime, skills, tools, and parent identifiers; verify evidence failure cannot be reported as complete capture.
- [ ] 6.2 Correlate child agents, approvals, plans, diffs, events, costs, output gaps, verification, cancellation, and terminal status through one bounded event protocol; verify parallel output remains attributable and sequence gaps are detected.
- [ ] 6.3 Add consented sanitized asciicast v3 output, resize, marker, and exit recording with encrypted storage, retention, deletion, export, and visible incomplete-capture states; verify raw keyboard input and excess environment values are excluded by default.
- [ ] 6.4 Implement detach/reconnect/stop semantics and bounded flow control for future browser terminals without making the edge coordinator a PTY host; verify tab loss does not kill the run and explicit stop remains separately authorized.

## 7. Portability, recovery, and lifecycle

- [ ] 7.1 Export each Desktop Tools profile and immutable recipe references without credentials or private machine data; verify a fresh standalone target produces the same plan digest from the export.
- [ ] 7.2 Build a signed offline bundle for the canary profile and platform, then verify network-denied plan/apply/verify and explicit missing-secret remediation.
- [ ] 7.3 Add safe ownership-aware adoption and deprovision behavior for existing machines; verify user data, modified files, unowned resources, and unsupported effects are preserved.
- [ ] 7.4 Exercise credential renewal, profile revision, device revocation, rebuild, signer rotation, bad-release rollback, and hosted-service outage; verify historical recovery material remains usable where retained evidence depends on it.

## 8. Canary promotion and integration evidence

- [ ] 8.1 Run focused strict TypeScript, schema, auth, profile, release, engine, terminal, secret, and documentation suites for each preceding group and resolve introduced regressions without weakening gates.
- [ ] 8.2 Complete one disposable headless platform lifecycle from profile URL through approval, OpenCode launch, plan, apply, verify, unchanged rerun, interruption/resume, rollback, and deprovision preview; publish a redacted signed receipt bound to the release and platform cell.
- [ ] 8.3 Verify denial, expiry, replay, profile-race, provider outage, hosted-service outage, recording failure, telemetry timeout, and rollback scenarios on the canary without mutating unrelated hosts.
- [ ] 8.4 Run the full repository suite, generated-artifact drift checks, secret scans, action validation, strict OpenSpec validation, and independent promotion verification; record failures and external blockers without converting them to success.
- [ ] 8.5 Promote Desktop Tools documentation and the wildcard bootstrap only after the canary evidence is current, retain legacy compatibility for the declared window, and verify rollback restores the previous routing without deleting user state.

## Workflow follow-up

- Synchronize the accepted delta specifications into the durable specs after implementation verification.
- Archive the change only after production activation, canary evidence, compatibility evidence, and review requirements are satisfied.
