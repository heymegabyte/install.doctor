# Design

> **Architect:** codex
> **Architect Role:** assigned

## Context

See `proposal.md` for motivation and `specs/gpu-ollama-fleet/spec.md` for required behavior. Install Doctor already has GPU eligibility and idempotent Ollama-node reconciliation contracts, while the remaining work crosses host capability discovery, loopback services, authenticated Cloudflare origins, existing LiteLLM routing, and live KasmVNC workloads. Enrollment must preserve the project distinction between the internal development gateway and the customer-facing `aid` runtime, which does not use LiteLLM.

## Goals / Non-Goals

**Goals:** derive eligibility from observed NVIDIA VRAM; represent enrollment in portable desired state; reconcile exactly one deployment per eligible host; verify authenticated inference and desktop health before admitting a node to rotation; and preserve honest excluded, pending, degraded, and verified states.

**Non-Goals:** enroll low-VRAM Zen, expose Ollama directly to the public network, change the `aid` product runtime, replace KasmVNC/display services, invent Cloudflare identities or hostnames, or mutate a live host merely because repository policy exists.

## Decisions

1. **Capability-gated enrollment.** Discovery records the first NVIDIA GPU's VRAM and requires at least 8 GiB unless a host-specific operator override is present. A static hostname allowlist was rejected because hardware changes and new hosts would make it stale; an unrestricted override was rejected because it would silently weaken the default.
2. **Loopback origin with authenticated ingress.** Ollama binds to loopback and an already authorized Cloudflare tunnel provides authenticated reachability. Direct LAN/public binding was rejected because model APIs should not become ambient fleet services. Install Doctor may validate the origin contract but must not invent DNS, tunnel, or Access policy.
3. **Desired-state reconciliation, not append-only edits.** The reconciler keys deployments by stable host identity and model alias, producing at most one Legion and one Omen entry. Blind list append was rejected because repeated provisioning would duplicate routes. Runtime credentials resolve through `get-secret` with scoped Infisical authority and never enter generated configuration or logs.
4. **Health before admission.** A node joins simple-shuffle rotation only after bounded authenticated model inference succeeds and the host's KasmVNC desktop remains reachable with a non-blank framebuffer. Process-running checks alone were rejected because they do not prove inference, ingress, or desktop coexistence.
5. **Independent resource ownership.** Ollama and live GNOME/KasmVNC retain separate services, ports, restart policies, and failure domains. Reconciliation may apply bounded resource controls but may not stop or replace display services to make inference pass.

## Risks / Trade-offs

- [GPU discovery differs by driver/version] → parse bounded `nvidia-smi` output, retain raw redacted evidence, and report unknown rather than guessing eligibility.
- [Inference exhausts resources needed by the desktop] → use a 7B model, bounded concurrency, and an integrated desktop-health gate before and after admission.
- [Tunnel or secret authority is unavailable] → leave the node pending or degraded and keep existing healthy routes; never install plaintext fallback credentials.
- [A stale duplicate route survives] → plan by stable identity, preview the exact diff, and remove only entries owned by this reconciler after replacement health is proven.
- [Simple shuffle sends work to a degraded node] → couple admission to health evidence and use bounded health-aware retries without hiding persistent failure.

## Migration Plan

1. Discover Legion, Omen, and Zen capabilities without mutation and validate desired host identities, origin references, model aliases, and secret references.
2. Reconcile Omen locally with Ollama bound to loopback, then verify the approved model and authenticated origin while monitoring KasmVNC health.
3. Preview the LiteLLM route diff, add exactly one Omen deployment beside the existing Legion deployment, and run bounded inference plus desktop coexistence checks.
4. Confirm Zen remains excluded from Ollama while repairing its separate Coolify connectivity through the owning workflow.
5. Roll back by removing only the reconciler-owned Omen route and disabling its reconciler-owned Ollama service; preserve models, logs, desktop services, host-specific tunnel configuration, and the last known-good Legion route for diagnosis.
