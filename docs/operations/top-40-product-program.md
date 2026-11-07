# Top-40 product implementation program

This ledger maps the approved product recommendations to the active
`repository-wide-convergence` OpenSpec. A recommendation is complete only when its implementation,
focused tests, integrated verification, and required live evidence are complete. Interface code,
documentation, or a started workflow is not operational proof.

| # | Outcome | OpenSpec ownership | Status |
|---:|---|---|---|
| 1 | Activated signed production `/start` | B02, B09, B12, B13 | Blocked on production signer/R2 authority and verified canary |
| 2 | Installer engine is the sole mutation authority | B03–B06 | In progress |
| 3 | First fully verified platform cell | B09, B12 | Pending real-host full-lifecycle receipt |
| 4 | One canonical product-state ledger | R30, R32 | In progress; contradictory legacy ledgers remain |
| 5 | Explicit Install Doctor versus desktop.tools boundary | R30 | Product decision required before routing migration |
| 6 | Production TUI over the canonical event stream | B03, B08 | Partial renderer; final design/evidence pending |
| 7 | Safe adoption of existing machines | B03–B06, L04–L06 | Partial discovery/planning contracts |
| 8 | Real interruption and reboot recovery | B05, B12 | Synthetic interruption covered; SIGKILL/reboot proof pending |
| 9 | Host-level uninstall/deprovision | New fleet-bootstrap task required | Not implemented |
| 10 | Operator-usable signed offline installation | B07, B12 | Strong engine foundation; enrolled return path/live proof pending |
| 11 | Rollback/freeze-resistant update metadata | B02, B07 | Partial signed envelope; TUF-equivalent freshness policy pending |
| 12 | Complete signed SBOM and provenance per release | R09, B02, B10 | Existing SBOM is incomplete and not release-bound |
| 13 | Auditable CI signing with offline verification | B02, IG02–IG04 | Partial OIDC and SSHSIG design |
| 14 | No plaintext signing-key staging | IG02, B02 | Pending inherited-FD signer path |
| 15 | Bounded sudo credential broker | R02, B03 | Blanket sudo removed; exported password paths remain |
| 16 | Infisical authority plus independent offline recovery | R04, IG01–IG07; fleet-backup-recovery | In progress |
| 17 | No ambient secret shadowing | R04, IG03 | Implemented in `5eabe84c`; fleet/runtime verification pending |
| 18 | Device scopes default deny | R03, R18 | Implemented in `2648d4ac`; production deployment/evidence pending |
| 19 | Hardened browser pairing | R03, R21 | Pending entropy, quota, rate-limit, and privacy work |
| 20 | Cloudflare-first OIDC onboarding | R03, IG07 | Partial; OAuth callback registration/live session proof pending |
| 21 | Complete versioned `ENVIRONMENT.md` model | B01, B03, R23 | Partial v2: explicit v1 migration, role overlays, and machine exceptions; recipes, automations, retention, permissions, budgets, and team policy remain |
| 22 | First-class plan/diff/recovery preview | B03, B06, L04 | Partial |
| 23 | Package and service rollback | B06, B12 | Configuration plus bounded service state only |
| 24 | Declarative native Windows path | B09, B12 | Unsupported until signed native lifecycle exists |
| 25 | Evidence-based platform support tiers | B09, B12 | Matrix exists; zero verified cells |
| 26 | Complete or explicitly unavailable provider coverage | R23, L02, L05, R09 | In progress |
| 27 | Live proof for every selected post-install hook | R14, B12 | Dispatch structurally verified; host proof pending |
| 28 | Real-catalog performance benchmark | B11 | Host identity fixed in `370c3c13`; real catalog workload pending |
| 29 | User-facing performance SLOs | B11, B10 | Fixture budgets exist; production SLO evidence pending |
| 30 | Observable, predictable lazy installation | L01–L08 | In progress |
| 31 | Structured installer telemetry wired to execution | B10, R22, L07 | Contracts exist; production call site pending |
| 32 | Durable Alloy/OTel offline queues | R22, IG05 | Pending |
| 33 | Evidence-derived sanitized support bundles | B10, R22 | Partial control-plane surface |
| 34 | Authenticated single-machine browser PTY | New aid vertical-slice task required | Not implemented |
| 35 | Durable Objects-backed terminal sessions | New aid vertical-slice task required | Proposed only |
| 36 | Durable idempotent fleet workflows | B04, R19 | Engine DAG partial; hosted orchestration pending |
| 37 | Real recording, sanitization, retention, and replay | B08, B10 | Formatter/event history only |
| 38 | Verified pinned skill install/update lifecycle | R25 plus new aid skill-lifecycle task | Policy gate exists; runtime absent |
| 39 | Turn successful History runs into automations | New aid automation task required | Not implemented |
| 40 | Verified time-to-ready north-star metric | B10, B11, R22 | Not yet an end-to-end product metric |

## Research protocol

Before an item moves from pending to implementation, record the installed/relevant version and
recheck primary documentation. Current research authorities include TUF, SLSA, Sigstore, GitHub
artifact attestations/OIDC, Cloudflare R2/Workers/Workflows/Durable Objects, Infisical identities,
OpenTelemetry Collector resiliency, WinGet Configuration/DSC, chezmoi, OpenCode skills, xterm.js,
and asciicast v3. Research cannot expand permissions, create paid infrastructure, or substitute for
live acceptance evidence.

## Release order

1. Trusted installer: 1–15.
2. Safe adoption and platform lifecycle: 16–30.
3. Fleet product and operations: 31–39.
4. Recommendation 40 governs prioritization and measures the integrated result.
