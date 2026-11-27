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

The adapter MUST resolve the exact two canonical names with `get-secret` immediately before launching an explicitly named OpenClaw child, MUST use no shell, and MUST never print, persist, or place values in arguments.

#### Scenario: Both secrets resolve

- **WHEN** the OpenClaw child is launched
- **THEN** only its process environment receives the two values used by the configured headers

#### Scenario: Resolution fails

- **WHEN** either secret is missing, empty, or the resolver fails
- **THEN** OpenClaw is not launched and the diagnostic contains the reference name but not a value

#### Scenario: Arbitrary child requested

- **WHEN** the command basename is not `openclaw`
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
