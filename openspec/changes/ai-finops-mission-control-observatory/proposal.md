# Proposal: Provisioning Support for AI FinOps Mission-Control Guardrails, Paperclip Fleet Secret Bridge & Langfuse Spool

- **Architect:** antigravity
- **Architect Role:** assigned

## Why
`paperclip-fleet-usage-observatory@2.4.0` persists configurable FinOps soft/hard caps and pinned primary account state at `~/.paperclip/quotas-guardrails.json`, spools circuit-broken (`2500ms` timeout) Langfuse OTel telemetry spans to `~/.paperclip/langfuse-observatory-spool.jsonl`, and exports 9 fleet/Cloudflare secret keys (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, `DEEPSEEK_API_KEY`, `LITELLM_API_KEY`, `DAYTONA_API_KEY`, `SENTRY_AUTH_TOKEN`, `EXA_API_KEY`, `TAVILY_API_KEY`) to `~/.config/paperclip/deepseek.env` (`0600`) alongside `ensure-paperclip-openclaw-bridge.ts` (`ExecStartPre`) and `fn_paperclip_prune_operational_telemetry(14)`. Documenting and provisioning these host paths in `install.doctor` ensures newly provisioned workstations and fleet nodes preserve FinOps guardrails, Cloudflare deployment autonomy, and Paperclip control-plane invariants across re-provisioning.
