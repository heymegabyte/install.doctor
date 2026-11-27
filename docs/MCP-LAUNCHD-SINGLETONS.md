# MCP per-user singletons

Install Doctor supervises session-independent local MCP wrappers with one per-user broker instead of one Node backend per client. macOS uses launchd and Linux uses a systemd user unit. The broker exposes only mode-0600 Unix sockets under a mode-0700 state directory; it does not listen on TCP.

```sh
mcp-singleton-manager install
mcp-singleton-manager status
mcp-singleton-manager rollback
```

`MCP_SINGLETON_SERVICES` may narrow the canonical default service list for a host profile. It must never be used to grant a host tools outside its approved profile. Linux installation enables the user unit for that user's normal systemd session; it deliberately does not enable lingering and never installs a root or system service.

The systemd unit uses private temporary storage, strict read-only system paths, and explicit per-user writable paths. Capability-changing directives, including `ProtectKernelModules`, are intentionally omitted because restricted containers and some Proxmox guests reject them even for unprivileged user services; the broker already runs without root and exposes no network listener.

Eligible services are Cloudflare, Langfuse, Paperclip, theme.tools, and the current descriptor-only VoiceKit wrapper. CUA Driver and BrowserMCP remain session-scoped frontends to their supported shared daemons. DataForSEO follows its native Streamable HTTP path.

Clients connect to the corresponding socket with `/usr/bin/nc -U ~/.local/state/mcp-singletons/sockets/<service>.sock`. Preserve the previous client configuration until initialize, tools/list, one allowed call, concurrent isolation, restart, and rollback checks pass.

`status` waits through launchd throttling and then performs real `initialize` and `tools/list` protocol probes for every configured backend. Socket files alone are not considered healthy.

The LaunchAgent intentionally uses launchd's standard process class. `ProcessType=Background` is not appropriate for latency-sensitive JSON-RPC pipes and can starve backend startup on a busy workstation.

Cloud-hosted services should still be reached through their authenticated Cloudflare MCP surfaces. The local singleton is for host-local/offline-safe adapters and for a bounded compatibility bridge; loss of the network must degrade cloud tools without expanding local authority.

