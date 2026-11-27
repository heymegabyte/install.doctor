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
- Separate migration from deletion: this change does not decrypt for inspection, rotate/revoke credentials, delete encrypted templates, remove age identities, or widen permissions.
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

## Out of scope

- Reading or exporting plaintext secret values for audit.
- Automatic deletion of chezmoi templates or age keys.
- Automatic credential rotation or revocation.
- Migrating interactive personal credentials that belong in a human password manager.
- Granting a workstation or server the complete legacy inventory.
- Treating filenames, `.infisical.json`, environment variables, or possession of an age key as authorization.

## Success criteria

- Every tracked encrypted secret name has a value-free disposition and owner.
- Every host grant is the exact intersection of its bound profile, evidenced capability groups, environment, and explicit exceptions.
- Online operational consumers resolve from Infisical and fail closed outside their grants.
- macOS and Ubuntu identities can read only their own project root and receive `403` across the host-project boundary.
- Dedicated macOS and Ubuntu hosts resolve from their dedicated project root, while explicitly declared legacy managed workstations temporarily retain their Global-project host paths until migrated.
- `--workload` and `--host` are mutually exclusive, and workload plans use only the general encrypted inventory plus their declared workload policy.
- Offline recovery remains independently testable without making the legacy inventory an ambient online fallback.
- Only an explicitly reviewed canary source may retire after positive and negative acceptance evidence; broader source retirement remains separately gated.
- `invalid-retired`, missing, stale, or otherwise unverified validation records are rejected during preflight, leaving every destination unchanged.
