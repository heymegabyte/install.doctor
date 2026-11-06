# Bootstrap release operations

The production installer release is a four-boundary process. A successful job is not evidence that
`/start` is live until the activated pointer, immutable objects, Worker bindings, and public endpoint
are independently verified.

## Authority boundaries

1. `build` checks out `master`, reproduces the engine, verifies the exact Node runtime closure against
   the Node.js release keyring, and emits an inert seven-file unsigned release. It has no OIDC token and
   receives no secret.
2. `sign` runs in the protected `bootstrap-release-sign` environment without a checkout. It verifies
   the hard-pinned signer-script digest and resolves only `INSTALL_DOCTOR_RELEASE_SIGNING_KEY` from the
   Infisical `/ci/bootstrap-release/signer` leaf using GitHub OIDC. The key is erased before artifact
   upload.
3. `publish` runs in `bootstrap-release-publish`. It receives only credentials for the immutable
   release-object bucket and can neither sign nor activate. Publication is create-only with byte
   read-back and commits the manifest last.
4. The separate `Activate published bootstrap release` workflow runs in `bootstrap-release-activate`.
   It receives read-only release-bucket
   credentials plus credentials for a separate channel bucket. It re-verifies the complete signed
   release, writes an intent, and advances `stable` with an expected-ETag compare-and-swap. Rollback is
   a new forward activation, never pointer history deletion.

The two buckets are a security boundary, not an organizational preference. R2 S3 credentials do not
provide an object-prefix policy strong enough to prove that a release publisher cannot rewrite a
channel pointer. Configure an R2 bucket-lock rule on immutable release objects as an additional
availability safeguard; do not treat the client-side create-only check as provider-enforced retention.

## One-time external provisioning

These actions require authorized production access and are intentionally not fabricated by repository
tests:

- Create distinct R2 release-object and channel buckets. Configure release-bucket retention/bucket lock
  after confirming the rollback and cost policy.
- Bind the Worker as `RELEASES` (release objects) and `RELEASE_CHANNELS` (channel records).
- Create the ten GitHub environments named in the workflows. Require reviewers for signing and
  activation; prevent unreviewed branch deployment. The continuity monitor must not require manual
  approval, or its six-hour alert cannot run, but it receives read-only storage credentials.
- Create the ten Infisical GitHub-OIDC machine identities described by
  `config/infisical/bootstrap-release-identities.json`. Bind the immutable repository and owner IDs,
  exact workflow path, `master` ref, environment, audience, subject, and event where declared. Do not
  add inherited project-wide roles or let the normal and renewal workflows share an identity.
- Put only the declared leaf values in each Infisical path. The publisher must have release-bucket
  credentials only. The activator uses a distinct read-only release credential and channel credential.
- Generate or approve the production Ed25519 SSHSIG identity under the documented custody, recovery,
  rotation, and revocation procedure. Add only its public key and signer id to
  `packages/control-plane/src/release-trust.json`; never commit the private key.
- Add the nonsecret GitHub variables referenced by the workflows: `INSTALL_DOCTOR_RELEASE_SIGNER_ID`,
  `INFISICAL_PROJECT_SLUG`, and the ten Infisical identity ids.

The protected environment, exact-workflow OIDC conditions, branch/ruleset protection, and required
reviewers are mandatory compensating controls because GitHub-hosted signing still materializes the raw
private key briefly. Do not describe this as HSM-enforced policy. A future signer broker or HSM should
accept the renewal bundle and enforce the same-payload policy without releasing key bytes to a runner.

Until a public key is present in `release-trust.json`, production release construction fails closed.
Until both R2 bindings contain a valid activated release, `/start` returns 503 without a mutable
fallback.

## Release and verification

Dispatch `Production bootstrap release` from `master` with a new immutable release id. It builds,
signs, and publishes exactly once; it never activates. Inspect the immutable objects and publication
evidence. Then dispatch `Activate published bootstrap release` with that same release id and the exact
current channel ETag (`-` is accepted only when the channel does not exist). Activation re-reads and
signature-verifies the already-published bytes, requires at least 96 hours of remaining signed validity,
advances the channel with compare-and-swap, and blocks until the public launcher and detached manifest
signature identify the selected release. Never rerun publication with an existing release id to activate
it: manifest timestamps would differ and the create-only publication boundary must reject the collision.

Every manifest expires within seven days. `Bootstrap release continuity` checks the signature-verified
channel every six hours using a dedicated read-only identity and fails loudly once 96 hours remain.
Begin a new-ID renewal no later than 96 hours remaining,
escalate at 48 hours and 12 hours, and treat an expired or unavailable channel as an install outage.
Renewal must preserve the currently approved source and payload unless it is separately approved as a
new feature release; extending expiry in channel metadata is never valid. The repository freshness
inspector reports `healthy`, `renewal-required`, or `expired` only after pointer digest, signed release
inventory, signer identity, and validity checks.

The renewal preparation command is intentionally inert: it reads and signature-verifies the exact
active envelope, derives `renew-v1-YYYYMMDD-MANIFESTDIGEST16`, fixes creation at UTC midnight and expiry
at exactly seven days, copies every payload byte unchanged, and writes separate `source`, `unsigned`,
and `renewal-plan.json` inputs. Do not pass the unsigned result to the general release signer. The
dedicated `sign-bootstrap-renewal.sh` snapshots the bundle into signer-owned storage, authenticates the
source SSHSIG with the signing key's public identity, proves all six payloads byte-identical, permits
only release id, timestamps, and exact release URLs to change, and signs without invoking caller-selected
code. It also signs the exact plan under the separate `install.doctor.release-renewal-plan` SSHSIG
namespace. `activate-renewal` verifies that attestation, then re-reads the authoritative stable pointer and both published envelopes,
requires the plan's captured ETag/generation/activation and source digest to still be current, repeats
the byte/invariant proof, and performs one CAS. The manual renewal workflow binds retries to one UTC day,
derives its activation UUID and timestamp deterministically from the signed plan, and reconciles a
post-CAS receipt outage without advancing the channel twice. Repository automation is ready, but live
renewal remains unverified until all ten protected identities/environments, exact R2 grants and denial
probes, public canary, and key-custody controls are provisioned and evidenced.

If activation returns exit 75, the channel CAS already committed but its secondary receipt copy is
pending. The activation workflow invokes `reconcile stable ACTIVATION_UUID`; reconciliation creates the
receipt only when the immutable intent bytes exactly equal the current authoritative channel pointer.
It accepts an existing byte-identical receipt, rejects a collision, and never retries channel CAS.

After activation, verify all of the following:

```bash
curl -fsS https://app.install.doctor/start | sh -n
curl -fsSI https://app.install.doctor/releases/RELEASE_ID/manifest
curl -fsS https://app.install.doctor/releases/RELEASE_ID/manifest -o /tmp/install-doctor-manifest
curl -fsS https://app.install.doctor/releases/RELEASE_ID/start | sh -n
```

Every schema-v5 signed release preserves an immutable `start` launcher. The isolated signer derives its
public key, finalizes the release-specific launcher from the inert builder template, records the exact
launcher URL, SHA-256 digest, and size in the manifest, and only then signs the inventory. Historical
launchers remain create-only release objects, so upgrade canaries must invoke the exact v1 and v2
launchers rather than the mutable stable `/start` route. Renewal re-renders only the release URLs and
expected release identity; it proves ordinary payload bytes are unchanged and signs the new launcher
binding with the renewed envelope.

Then run clean-install, interruption/resume, rollback, upgrade, and unchanged-second-run canaries for
each promoted platform cell. Preserve receipts and do not mark a running or skipped cell verified.

Repository gates:

```bash
bash scripts/test-bootstrap-release-workflow.sh
bash scripts/test-bootstrap-release-publisher.sh
bash scripts/test-bootstrap-install-acceptance.sh
bash scripts/test-bootstrap-upgrade-acceptance.sh
npm --prefix packages/control-plane test
```
