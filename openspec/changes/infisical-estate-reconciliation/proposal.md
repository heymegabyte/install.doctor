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
- Offline recovery remains independently testable without making the legacy inventory an ambient online fallback.
- No source deletion occurs without a later, separately approved retirement plan backed by completed cutover evidence.
