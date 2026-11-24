# Infisical estate reconciliation

**Architect Role:** assigned

## Why

Encrypted chezmoi templates currently hold a broad legacy secret inventory, while only a small subset of repositories and hosts are bound to Infisical. Operators need macOS and Ubuntu workstation/server secrets to work reliably without copying the entire inventory into every workload.

## What changes

- Add a value-free desired-state manifest for repository and host secret scopes.
- Add an idempotent planner/reconciler that derives explicit secret allowlists from host roles and repository evidence.
- Keep bootstrap and recovery material in age-encrypted install.doctor storage; move operational delivery to Infisical.
- Use GitHub OIDC for CI and short-lived Infisical authentication for hosts.
- Never log secret values or persist decrypted staging files.

## Out of scope

- Automatic credential rotation or revocation.
- Granting every host or repository the complete legacy secret inventory.
- Treating local `.infisical.json` files as secret-bearing credentials.
