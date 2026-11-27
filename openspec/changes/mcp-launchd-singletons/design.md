# Design: Canonical per-user MCP singleton deployment

**Architect Role:** assigned

## Canonical ownership and eligibility

The canonical MCP registry declares whether a server is remote, local-session, direct HTTP, or eligible for a local singleton bridge. Install Doctor consumes a pinned registry revision and rejects unknown, stale, conflicting, or locally promoted entries.

A wrapper is singleton-eligible only when it is session-independent, safely multiplexable, compatible with concurrent virtual MCP sessions, and free of foreground user-presence, active-browser, GUI, terminal, or per-client credential requirements. Eligibility records the stable MCP ID, owner, executable/artifact identity, protocol/transport, risk, network dependency, secret references, health behavior, and rollback route.

CUA Driver and BrowserMCP retain their supported shared daemon plus per-session frontend architecture. Filesystem, shell, desktop-control, and other host-control tools remain local and lazy. DataForSEO remains outside the generic broker while it uses its native Streamable HTTP route. Process-count reduction alone never justifies remote exposure or singleton promotion.

## Host-specific least-privilege profiles

Each enrolled host selects a versioned, deny-by-default profile bound to stable host identity, platform, role, and environment. A profile contains an explicit allowlist of canonical singleton IDs plus exact artifact/version constraints, secret references, network/offline class, service-manager target, graphical/session requirement, resource ceilings, and explicit denials.

The effective set is the intersection of canonical registry eligibility and the host profile. Unknown hosts, role conflicts, stale profiles, unsupported platforms, missing artifacts, unresolved required secret references, or profile attempts to broaden registry eligibility fail closed before rendering. macOS workstation and Ubuntu workstation/server profiles are independent; a macOS success does not establish Ubuntu support.

Profiles do not contain secret values. Runtime credentials resolve through approved host-bound secret mechanisms and remain scoped to the underlying wrapper. The broker does not pool credentials across MCP identities or hosts.

## Broker and client isolation

One broker instance runs per logged-in/enrolled user and supervises only that profile's eligible wrappers. Each service receives a private Unix socket in a user-owned mode-`0700` runtime directory; sockets are mode `0600`. No TCP, wildcard, LAN, tunnel, or public listener is created.

Each client connection has an isolated virtual MCP session. The broker namespaces JSON-RPC request IDs, routes responses and notifications only to the owning connection, bounds frames and queues, propagates cancellation, applies timeouts/backpressure, and discards pending ownership on disconnect. A wrapper that cannot preserve multi-session isolation is rejected or remains per-session.

## macOS launchd lifecycle

macOS uses a per-user LaunchAgent in the `gui/<uid>` domain, never a root LaunchDaemon. The definition uses an absolute pinned broker path, `Umask=0077`, minimal allowlisted environment, bounded restart throttling, sanitized logs, and a private runtime directory. Installation validates the plist before `bootstrap`; health uses `launchctl print` plus broker/socket protocol probes. Reconciliation prevents competing labels and duplicate brokers.

The existing primary-workstation launchd and Codex migration evidence remains valid for macOS only.

## Ubuntu systemd user lifecycle

Ubuntu uses a user service under `~/.config/systemd/user` and a private Unix socket beneath `%t/mcp-singletons` (`%t` is the user's runtime directory). Definitions use absolute pinned paths, `UMask=0077`, bounded `Restart=on-failure`, start-rate limits, sanitized journal fields, explicit resource limits, and compatible systemd sandboxing such as `NoNewPrivileges`, `PrivateTmp`, and write access limited to required runtime/state paths.

The unit starts in the enrolled user's user-manager scope, not as a system service and not as root. Install Doctor must not enable lingering implicitly. A headless profile that requires operation without an interactive login declares and separately authorizes lingering, with explicit owner, resource ceiling, and rollback. `daemon-reload`, enable/start, health, stop, disable, and removal are idempotent and verified through `systemctl --user`.

## Offline-safe local boundary

The broker, Unix socket, service-manager health, configuration validation, and rollback must work without network access. Startup must not block the user manager indefinitely while resolving secrets or contacting remote upstreams. Remote-dependent wrappers use bounded lazy initialization and report a typed unavailable/degraded state when their upstream or secret broker is offline.

Offline mode never falls back to a broader host profile, cached foreign credential, local shell/filesystem MCP, alternate user, or unauthenticated upstream. Local/session MCPs continue through their independent supported paths. Client initialization and discovery either return the locally admitted stable surface with unavailable calls failing clearly, or fail within a bounded timeout; they must not hang or silently route elsewhere.

No credential value is persisted to make offline startup pass. Explicit offline/recovery exceptions remain governed by Install Doctor's secret policy and are not implied by singleton eligibility.

## Rendering, installation, and migration

The renderer takes the pinned registry, exact host profile, platform facts, artifact evidence, and destination paths and produces deterministic service definitions and client shims. It validates schema, canonical eligibility, paths, permissions, duplicate labels/sockets, executable identity, secret-reference names, and platform support before mutation.

Installation snapshots existing service and client configuration, stages definitions atomically, validates them, activates one canary service, and verifies initialize, `tools/list`, an allowed read-only call, forbidden call, concurrent request-ID isolation, disconnect/cancellation, restart, upstream outage, offline startup, and rollback. Client entries migrate only after the service passes. Unrelated entries and session-bound tools remain untouched.

## Health and observability

Health distinguishes manager state, broker process, socket owner/mode, protocol readiness, wrapper readiness, upstream degradation, secret unavailability, duplicate/orphan processes, crash loops, artifact drift, and stale sockets. Logs and receipts contain MCP IDs, versions, states, timestamps, plan/profile digests, and bounded errors, but no secret values, request payloads, authorization headers, or sensitive tool results.

## Rollback

Rollback is platform- and profile-scoped. It restores the exact saved client commands and predecessor service definition, stops and disables only the affected broker, removes only its managed sockets/state after verifying ownership, and retains redacted evidence. macOS rollback uses `bootout` in `gui/<uid>`; Ubuntu rollback uses `systemctl --user disable --now` followed by `daemon-reload`.

Rollback never kills `cua-driver serve`, BrowserMCP, valid client-parented session MCPs, other users' processes, unrelated service units, or remote portal entries. A failed rollback is reported and preserves recovery artifacts rather than deleting evidence.

## Risks

- **Host profile broadens registry authority:** enforce intersection semantics and pinned registry/profile digests.
- **systemd unit becomes a root or fleet-wide daemon:** require user-manager scope and prohibit implicit lingering.
- **Socket or runtime directory exposes tools:** enforce ownership/modes and reject symlink or path substitution.
- **Offline outage causes hangs or unsafe fallback:** use lazy bounded initialization and typed degraded states with no authority expansion.
- **Concurrent sessions cross-talk:** namespace requests/notifications and test repeated IDs, cancellation, disconnect, and backpressure.
- **Secrets leak through service metadata:** allowlist environment and redact logs/receipts; store references only.
- **Rollback removes session tools or unrelated config:** bind all mutations to exact managed identities and preserved snapshots.

