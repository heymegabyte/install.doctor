# OpenClaw MCP automation adapter

## ADDED Requirements

### Requirement: Canonical host-bound identity

The adapter MUST accept only the pinned macOS or Ubuntu automation profile and MUST fail before output or secret resolution when its workload, project, environment, path, endpoint, secret names, or two Cloudflare Access header bindings differ from the closed expected values.

#### Scenario: Host profile matches

- **WHEN** the caller selects `macos-workstation` or `ubuntu-runner`
- **THEN** the adapter selects that host's canonical automation profile and no other identity

#### Scenario: Identity drifts

- **WHEN** any canonical automation identity or header binding differs
- **THEN** the adapter fails closed without resolving credentials or writing config

### Requirement: Secret-free registration

The adapter MUST merge one `megabyte-automation` Streamable HTTP server into `mcp.servers`, preserve all unrelated config, and store only exact environment placeholders in its Cloudflare Access headers.

#### Scenario: Existing OpenClaw config

- **WHEN** the config contains unrelated top-level settings, MCP settings, or MCP servers
- **THEN** apply preserves them byte-equivalently as JSON values and changes only the owned registration

#### Scenario: Foreign collision

- **WHEN** `megabyte-automation` exists without Install Doctor ownership
- **THEN** plan and apply fail without mutation

### Requirement: Runtime-only injection

The adapter MUST resolve the exact two canonical names with `get-secret` immediately before launching the exact absolute child executable authorized by the caller, MUST use no shell, and MUST never print, persist, or place values in arguments.

#### Scenario: Both secrets resolve

- **WHEN** the OpenClaw child is launched
- **THEN** only its process environment receives the two values used by the configured headers

#### Scenario: Resolution fails

- **WHEN** either secret is missing, empty, or the resolver fails
- **THEN** OpenClaw is not launched and the diagnostic contains the reference name but not a value

#### Scenario: Executable substitution requested

- **WHEN** the child executable differs from `--allowed-executable`
- **THEN** the adapter rejects it before secret resolution

### Requirement: Reversible protected installation

Plan MUST be read-only and metadata-only. Apply MUST atomically write mode-0600 config, snapshots, and receipt. Rollback MUST refuse drift and restore the exact predecessor.

#### Scenario: Metadata-only plan

- **WHEN** plan runs against an existing config
- **THEN** it reports digests and preservation counts without config contents or secret values and makes no change

#### Scenario: Clean rollback

- **WHEN** the installed output still matches its receipt
- **THEN** rollback restores the exact predecessor

#### Scenario: Post-install drift

- **WHEN** an operator changes the installed output
- **THEN** rollback refuses to overwrite it

### Requirement: Reversible systemd-user cutover

The reconciler MUST install stable mode-0600 runtime assets and a user-service drop-in that preserves the reviewed direct Node Gateway argv and port exactly. Plan MUST bind apply to the observed unit `ExecStart` digest. Apply MUST validate syntax, reload the user manager, restart the Gateway, prove it active, and restore the complete predecessor on failure.

#### Scenario: Reviewed direct Node service

- **WHEN** plan receives the exact absolute Node/OpenClaw gateway argv
- **THEN** it reports argv and current-unit digests plus the port without printing the argv, and renders the original argv unchanged after the adapter boundary

#### Scenario: Unit changes after review

- **WHEN** the active unit `ExecStart` digest differs from the plan digest at apply
- **THEN** apply fails before writing files or restarting the service

#### Scenario: Activation succeeds

- **WHEN** atomic installation completes and unit verification, reload, restart, and active checks pass
- **THEN** the stable assets and drop-in remain installed with mode `0600`

#### Scenario: Verification or health fails

- **WHEN** unit validation, restart, or active health fails
- **THEN** every installed file is restored to its predecessor and the reconciler reloads and attempts to restart the prior service
