# Infisical estate reconciliation and host-profile hardening

**Architect Role:** assigned

## Why

Install Doctor still carries a large legacy inventory of age-encrypted chezmoi secret templates while online workloads increasingly resolve operational secrets from Infisical. The existing reconciliation foundation can plan and write selected names safely, but its broad workstation profile and incomplete cutover contract risk over-granting hosts, retaining two ambiguous authorities indefinitely, or deleting recovery material before replacement access is proven.

The estate needs a value-blind, least-privilege migration that makes Infisical authoritative for online operational delivery while retaining only explicitly justified offline/bootstrap/recovery material under age encryption.

## What changes

- Replace broad host profiles with versioned, deny-by-default profiles bound to stable host identity, role, environment, platform, and evidenced capability groups.
- Inventory encrypted sources by path and secret name without decrypting values, and classify every name as operational migration, documented offline exception, blocked/unknown, or retired candidate.
- Migrate only reviewed operational allowlists through memory-only decrypt-to-Infisical writes.
- Introduce a dual-read transition in which Infisical is preferred and age fallback is allowed only for explicitly recorded migration or offline-recovery cases.
- Require retrieval, consumer, outage, replacement-host, and rollback evidence before declaring Infisical authoritative for a secret.
- Treat exact-source deletion as the terminal migration step after validation, destination round trips and target retrieval, consumer cutover, recovery, observation, and retirement assertions pass; credential rotation/revocation and age-identity removal remain separate actions.
- Harden host enrollment, expiry, revocation, drift detection, and profile downgrade behavior.
- Use separate Infisical projects for macOS and Ubuntu hosts so free-plan project roles enforce host-class isolation without organization-wide read access.
- Use short-lived Universal Auth access tokens and bounded client-secret credentials stored in platform-appropriate protected storage.
- Require every managed host declaration to specify both its exact Infisical `projectId` and `secretPath`; never infer project authority from the current directory, home directory, or ambient Infisical configuration.
- Correct the discovered source-precedence defect: `secrets-workstation` is a macOS-host override, not a fleet-wide preferred inventory.
- Keep AI provider upstream credentials only on the Ubuntu/LiteLLM runtime; macOS receives scoped LiteLLM client credentials rather than raw upstream keys.
- Add a durable metadata-only credential validation ledger and require every apply-selected credential to have current `status: valid` evidence from an approved validator before any write begins.
- Record value-free migrated-destination evidence and exact source-retirement assertions so cutover and retirement are auditable without retaining or fingerprinting secret values.
- Add first-class workload targets that are selected independently from hosts; begin with `workloads.mcp.megabyte.space` routed to its dedicated Infisical project root.
- Route Cloudflare-native MCP provider credentials only to the MCP workload target, never through macOS, Ubuntu, or legacy workstation host profiles.
- Inventory every encrypted entry from the general, workstation, and WordPress stores as a distinct source identity, even when multiple sources share a canonical secret name.
- Require provider-specific validation before any credential is admitted for migration or runtime use, and retire provider-confirmed invalid sources through an auditable invalid-retirement path.
- Delete an encrypted source only after every required least-privilege destination has passed Infisical round-trip, target-host/workload retrieval, consumer cutover, rollback, and source-retirement gates.
- Keep source listings, profiles, target mappings, validation records, and retirement state synchronized so stale or unlisted sources cannot be selected implicitly.
- Add an explicit `wordpress-platform.megabyte.space` workload boundary for the 14 `secrets-wordpress` sources, backed by a dedicated Infisical project rather than any host, Global, MCP, macOS, or Ubuntu project; split consumers into additional site workload projects whenever one runtime identity does not require the complete reviewed allowlist.
- Classify the Coolify and Ubuntu Cloudflare Access SSH service-token pairs as controller-side SSH client credentials: grant the four exact names only to the macOS controller profile, remove them from generic `CF_`/Cloudflare capability matching, and deny them to Ubuntu and managed destination hosts.
- Route the byte-identical general/workstation Cloudflare Teams pair only as bounded WARP enrollment bootstrap for macOS and Ubuntu, exclude every other host/profile, and replace the shared century-lived token with independently revocable host tokens before final cutover.
- Classify the unused general/workstation `CLOUDFLARE_ORIGIN_CA_KEY` sources as retirement candidates with no destination unless a current certificate-issuance consumer is explicitly evidenced; never admit them through generic Cloudflare or macOS profiles.
- Bind the general `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` pair to the macOS-run `megabyte-os-e2e` verification capability only; do not infer compatibility from generic environment names or reuse it for Mission/Listmonk, Workers, MCP automation, or unrelated Access applications.

## Out of scope

- Reading or exporting plaintext secret values for audit.
- Ungated, bulk, name-only, or best-effort deletion of chezmoi templates, and removal of age keys or identities.
- Automatic credential rotation or revocation.
- Migrating interactive personal credentials that belong in a human password manager.
- Granting a workstation or server the complete legacy inventory.
- Treating filenames, `.infisical.json`, environment variables, or possession of an age key as authorization.

## Success criteria

- Every tracked encrypted secret name has a value-free disposition and owner.
- Every tracked file in general, workstation, and WordPress inventories has a stable source identity, independent disposition, validation record, required-destination set, and retirement state.
- Every host grant is the exact intersection of its bound profile, evidenced capability groups, environment, and explicit exceptions.
- Online operational consumers resolve from Infisical and fail closed outside their grants.
- macOS and Ubuntu identities can read only their own project root and receive `403` across the host-project boundary.
- Dedicated macOS and Ubuntu hosts resolve from their dedicated project root, while explicitly declared legacy managed workstations temporarily retain their Global-project host paths until migrated.
- `--workload` and `--host` are mutually exclusive, and workload plans use only their one explicitly declared source store: general for ordinary/MCP workloads or `secrets-wordpress` for declared WordPress/site workloads.
- WordPress-store sources are selectable only through an explicit WordPress/site workload whose dedicated project, identity, source-store policy, and per-source capability allowlist are declared; no host profile or unrelated workload can discover or retrieve them.
- macOS can resolve the exact Coolify and Ubuntu SSH Access client pairs for its local proxy helpers; Ubuntu, Zen, Legion, Omen, unrelated workloads, and generic Cloudflare profiles cannot select or retrieve those credentials.
- macOS and Ubuntu alone can perform bounded WARP enrollment/recovery without a durable readable token file; WARP health does not substitute for MCP authentication, and Zen, Legion, Omen, and unrelated profiles receive no Teams pair.
- `CLOUDFLARE_ORIGIN_CA_KEY` has an empty destination set and cannot migrate until current consumer/validity evidence changes its reviewed disposition; otherwise it follows exact-source retirement gates.
- The `megabyte-os-e2e` pair is planned only for the macOS project and remains ineligible for apply/cutover until a real `os.megabyte.space` call succeeds; current `522` origin failure is BLOCKED evidence, not credential-valid acceptance.
- Offline recovery remains independently testable without making the legacy inventory an ambient online fallback.
- Every in-scope encrypted source is deleted after its own exact-source validation, required-destination round trips and target retrieval, consumer cutover, recovery/observation, offline-exception, and retirement-assertion gates pass; canary evidence never authorizes another source.
- `invalid-retired`, missing, stale, or otherwise unverified validation records are rejected during preflight, leaving every destination unchanged.
- An encrypted source remains present when any required destination, target retrieval, consumer cutover, offline exception, observation window, or rollback requirement is incomplete.
