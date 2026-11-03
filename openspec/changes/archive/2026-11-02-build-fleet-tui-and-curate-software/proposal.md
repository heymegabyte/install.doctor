# Build a safe fleet installer and curate the software catalog

## Why

The public bootstrap is not safe for interactive `curl | bash` use, software-group selection does not affect the install set, and installer concurrency starts processes before it is bounded. The catalog also mixes essentials, services, desktop applications, and deprecated tools without a machine-readable selection policy.

## What changes

- Serve a small stage-zero launcher that downloads a pinned provisioner to disk before executing it with terminal-safe stdin.
- Add a fast Gum-enhanced, headless-compatible planning experience for role, capabilities, network enrollment, and consent.
- Execute independent work with a bounded worker queue while serializing package-manager and privileged mutations.
- Make catalog defaults explicit and role-aware, add deterministic catalog quality validation, and generate GitHub popularity evidence separately from stable desired state.
- Retire Tailscale from new desired state without silently uninstalling a running deployment.
- Prefer uv for Python project/package workflows while leaving Poetry available on demand for legacy repositories.
- Keep premium-model work capability-routed through the canonical OpenCode/LiteLLM policy without changing the aid product's runtime routing decision.

## Impact

Bootstrap, control-plane `/start`, installx, software catalog, selected post-install configuration, tests, and operator documentation change. Existing installed applications and running services are not removed automatically.
