# scripts/ — Provisioning Tools

13 scripts + 10 partials power the install.doctor fleet provisioning system.

## Core Provisioning

- **Signed stage zero** — `curl -fsSL https://app.install.doctor/start | bash` verifies an immutable release, selects one signed Node 24 runtime closure for the detected macOS/Linux architecture, and then runs the provisioner and installer engine. A compatible system Node 22 or 24 is reused.
- **provision.sh** — Main provisioner. OS detection, package install, chezmoi apply, post-install hooks. 1186 lines.
- **provision.sh** — Authored provisioner source of truth; signed releases serve it through the control-plane stage zero, and no duplicate template generates it.
- **publish-bootstrap-release.sh** — Unprivileged unsigned-release builder. It verifies the provisioner against `source_commit`, reproducibly rebuilds the bundled engine from that exact commit and committed lockfiles, binds the canonical generated catalog and pinned upstream Node archives, emits the exact nine-file inert signer input with a schema-v4 premanifest and placeholder launcher key, and refuses any signing-key argument.
- **sign-bootstrap-release.sh** — Minimal signing boundary. It accepts only that sealed signer input, derives the Ed25519 public key, finalizes the immutable per-release `start` launcher, promotes the premanifest to published schema v5, binds the nine published objects, independently revalidates identity, validity, URLs, sizes, digests, ownership, modes, and link safety, then emits the detached SSHSIG without invoking Git, npm, or repository build code.
- **packages/control-plane/scripts/publish-release-to-r2.mjs** — Verifies the complete signed release, uploads immutable R2 objects with atomic create-only conditions and byte read-back, commits the manifest last, and performs ETag-CAS channel activation with forward rollback generations and immutable receipts. It never receives the signing private key.
- **test-bootstrap-install-acceptance.sh** — Runs the exact rendered signed `/start` launcher, provisioner, and bundled engine in a pinned network-disabled Linux container. It proves rejection before approval, real SIGINT cancellation with released evidence, automatic same-run resume with one mutation, authoritative completion, and an unchanged reapply.
- **test-bootstrap-upgrade-acceptance.sh** — Publishes two immutable commits as separately signed releases under one test signer, then proves v1 install, v2 approval isolation, exact changed-closure convergence, coexisting clean sources and provenance, authoritative receipts, and an unchanged v2 reapply in a pinned network-disabled Linux container.
- **lib/task-bootstrap.sh** — Immutable local-checkout bootstrap for Go Task. It pins the release and per-platform checksums, rejects unsafe archive inventories, and publishes only the exact verified binary into the user's private prefix.

## Libraries

- **lib/detect_os.sh** — SSOT for OS/role detection. Returns 12 OS types. Also: `detect_role()`, `detect_package_manager()`, `is_headless()`.

## Quality & Validation (all wired into CI)

- **test-detect-os.sh** — 14-assertion test suite. OS, role, package manager, headless, idempotency, embedded consistency.
- **validate-software-yml.sh** — Schema validator for 1171-entry software.yml. 3 checks + install method distribution report.
- **drift-check.sh** — `chezmoi diff` wrapper. `--json`/`--fix`/`--ci` modes. Source + target drift detection.
- **audit-deprecated.sh** — 160 deprecated entry audit. Categorization + `--json` mode.
- **generate-sbom.sh** — compatibility CycloneDX host/release inventory. Wired into CI.
- **generate-spdx3-release.mjs** — SPDX 3.0.1 Core+Software release inventory with exact file hashes.
- **generate-release-exploitability.mjs** — versioned exploitability evidence bound to SPDX bytes and the release closure.
- **validate-release-evidence.mjs** — fail-closed SPDX reference, integrity, and exploitability-link verifier.

## Platform-Specific

- **homebrew.sh** — Homebrew install/management utilities
- **cloudflared-ssh.sh** — CF Tunnel SSH proxy setup
- **cloudflared-opnsense.sh** — CF Tunnel for OPNSense firewalls
- **pfsense.sh** — pfSense firewall provisioning
- **qubes-provision.sh** — Qubes OS dom0/AppVM provisioning
- **test-linux.sh** — Linux VM provisioning test driver (CI)
- **test-macos.sh** — macOS provisioning test driver (CI)

## Shared Partials (10 files in partials/)

Reusable bootstrap fragments for focused scripts and future generated entrypoints: basic-deps, full-disk-access, homebrew, import-cloudflare-certificate, logg, pfsense-netdata, pfsense-saml, pfsense-unifi, reboot, software.yml.header. The served `provision.sh` remains authored directly.
