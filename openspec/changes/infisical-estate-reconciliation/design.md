# Design

**Architect Role:** assigned

The reconciler separates discovery, planning, and apply. Discovery reads secret names, repository manifests/workflows, host roles, existing value-free Infisical bindings, and GitHub repository metadata. Planning produces deterministic project, path, identity, GitHub-variable, and secret-name actions without decrypting values. Apply resolves only selected values, keeps them in process memory, writes them through the Infisical CLI/API, and discards them after each bounded operation.

`macos.megabyte.space` uses a generous developer-workstation profile. `ubuntu.megabyte.space` uses a server-and-runner profile. Both profiles are still allowlists assembled from capability groups plus observed repository demand. Other hosts and repositories receive only directly evidenced capabilities.

GitHub Actions authenticates with repository-and-environment-bound OIDC claims. Hosts use independently revocable machine identities. Bootstrap credentials remain encrypted through install.doctor and only unlock short-lived Infisical sessions; operational secrets do not flow back into plaintext files.

Apply is fail-closed and idempotent. It must finish read-only inventory and produce a complete plan before mutating external state. It must not delete, revoke, or rotate credentials.
