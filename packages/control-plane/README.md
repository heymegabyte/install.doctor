# aid-control-plane (Phase A skeleton)

Cloudflare Worker + Hono — the browser-first control plane for `app.install.doctor`. This is the
START of Phase A, a skeleton, **not production**.

## Status (honest)

- `GET /health` → `200 {status:"ok", service:"aid-control-plane", phase:"A-skeleton", routes:N}`.
- `ALL /api/ai/v1/:route` → **501** for a known aid-core route alias (provider wiring pending),
  **404** for an unknown alias.
- NO provider call, NO secrets, NO D1 / Durable Objects / Queues / Workflows yet. The route
  contract (`ROUTES`) is imported from `../aid-core` — reused, not re-implemented (MASTER-PROMPT §8).

## Signed bootstrap status

`GET /start` is fail-closed until a source-pinned production release signer and immutable release
objects are configured. The launcher accepts macOS and Linux on x86-64 or ARM64, including Linux
environments such as WSL2, Proxmox, Qubes guests, and containers when their later capability checks
pass. Native Windows, FreeBSD, and unlisted architectures are rejected before release download.

Stage zero itself does not require Node.js. It supplies a fixed, non-ambient executable search path
that includes the trusted system and common Homebrew/Linuxbrew locations. The current signed
`provision.sh` and separately verified engine require Node 22 to already exist in one of those
locations; they do not yet install it. This is an explicit host prerequisite and migration boundary,
not a claim that the engine is a native standalone executable.

Production remains externally blocked on all of the following:

- approved custody, rotation, and recovery for a production SSHSIG private key, followed by adding
  only its public key to `src/release-keyring.ts`;
- an authorized production R2 bucket/binding, public read-back policy, and a completed production
  publication using the included create-only publisher;
- current canary evidence for each platform cell promoted from compatibility to verified support;
- if Node-free execution is required, reproducible per-platform runtime artifacts, manifest fields
  binding their platform, digest, and size, plus signing/publication tests. No such binaries or keys
  are created by this repository slice.

The repository now includes a create-only R2 publication and activation tool. It validates the exact
nine-file signed release inventory, including the source-commit-bound catalog, verifies SSHSIG, uploads every object with atomic
`If-None-Match: *`, reads bytes back, and publishes the manifest last as the release commit marker.
Channel activation uses ETag compare-and-swap, monotonic forward generations, and immutable intent
and receipt records; rollback is another forward activation to an already verified immutable release.
`/start` reads only the activated `bootstrap/channels/stable.json` pointer, validates its strict schema,
then digest-checks the referenced immutable manifest before resolving the signer through the
source-pinned keyring. Deployment variables cannot select a release URL or inject a trust anchor.
It deliberately cannot deploy without separately scoped R2 credentials and a source-pinned public
signer. The production workflow enforces an unprivileged build, no-checkout signer, immutable-object
publisher, and separate channel activator; production custody and external identities remain required.

The protected production workflow is `.github/workflows/bootstrap-release-production.yml`; its
external provisioning and verification runbook is `docs/operations/bootstrap-release.md`. Release
objects and channel records intentionally use separate R2 buckets/bindings so publication and
activation are provider-separable authorities.

## Dev / deploy

- `npm install` (installs `hono`).
- `npm run check` → `wrangler deploy --dry-run` (build gate; esbuild bundles the TS + aid-core).
- `npm run deploy` → needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in env (via `get-secret`).
- `npm run release:publish -- RELEASE_DIR RELEASE_ID` → create-only immutable-object publication
  using release-bucket-only `INSTALL_DOCTOR_RELEASE_R2_*` credentials and
  `INSTALL_DOCTOR_RELEASE_PUBLIC_KEY`.
- `npm run release:activate -- RELEASE_ID stable ETAG_OR_- UUID ISO_TIME [rollback PRIOR_UUID]` →
  remote release reinspection with read-only `INSTALL_DOCTOR_RELEASE_R2_*` credentials followed by
  CAS activation using separate channel-bucket `INSTALL_DOCTOR_CHANNEL_R2_*` credentials. A
  receipt-pending exit never means activation failed; reconcile the authoritative channel pointer
  before retrying.
- Full gate: `scripts/test-control-plane.sh` — Node security/unit tests, dry-run build, and (when
  `CONTROL_PLANE_URL` is set) prod `/health` + routing E2E.

## Next (see docs/aid/NEXT-STEPS.md)

Zod env + bindings; a real ProjectSites routing adapter → one CF AI Gateway (DeepSeek-first);
tenant/device identity; D1 metadata; a strict-TS typecheck step (tsconfig via `/update-config`).
