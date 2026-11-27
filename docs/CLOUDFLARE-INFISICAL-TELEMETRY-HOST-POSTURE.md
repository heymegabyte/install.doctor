# Host & Workstation Provisioning Posture: Cloudflare Zero-Trust, Infisical Universal Auth, Sentry Cron Check-Ins & OpenClaw Router (`cr`)

This document codifies the host-level provisioning invariants absorbed into `heymegabyte/install.doctor` from the `swarml.ink` (Paperclip) and `openclaw.swarml.ink` (OpenClaw) control plane:

## 1. Infisical Universal Auth Machine Identities & `0600` Agent Daemon Sinks
- Authenticate host services and agent daemons via **Infisical Universal Auth** (`/api/v1/auth/universal-auth/login`) with short-lived access token TTLs, CIDR restrictions, and project/folder-scoped least-privilege RBAC.
- Run `infisical agent` as a managed user-space service rendering in-memory or `0600` owner-only local sinks, paired with short-lived **Dynamic Secrets** for database and cloud leases.
- Enforce `infisical scan` in git pre-commit hooks across all developer workstations and server checkouts.

## 2. Cloudflare Zero-Trust Named Tunnel, Loopback Isolation & Google-Only Auto-Login (`blzalewski@gmail.com` & `brian@megabyte.space`)
- Keep Paperclip (`127.0.0.1:3100`), OpenClaw Gateway (`127.0.0.1:18789`), and PostgreSQL 17 (`127.0.0.1:54329`) strictly loopback-bound behind `agent-fleet-private-tunnel` (`cloudflared`) and Cloudflare Access (`manhattan` team).
- Enforce **Google-Only SSO** (`a8fe8491-624d-46db-ad17-cffa076ac422`) with `auto_redirect_to_identity: true` across all Cloudflare Zero Trust Access applications (`onetimepin` / email PIN IdP deleted), granting human access strictly to `blzalewski@gmail.com` and `brian@megabyte.space` only (and automatically signing into LiteLLM `https://llm.megabyte.space/ui` via Cloudflare Access Google SSO JWT verification).
- Propagate `NODE_OPTIONS=--use-system-ca` and `NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/managed-warp.crt` across all service drop-ins.

## 3. Sentry Cron Check-Ins + 9 Healthchecks Guardians Across All Systemd Timers & Routines
- Wrap all 10 active `ubuntu.megabyte.space` systemd `.timer` units and all 6 Paperclip scheduled routines in Sentry Monitor Check-Ins (`in_progress` → `ok` / `error`) alongside the 9 Healthchecks.io guardians (`pg-backup`, `docker-prune`, `resource-watch`, `budget-watch`, `fleet-liveness`, `restore-verify`, `worktree-prune`, `claude-pool`, `r2-offsite`).

## 4. OpenClaw Router (`cr`) Tri-Harness PACE Provisioning
- Provision Claw Router (`cr`) with pre-trusted project directories across `~/.claude.json` and `~/.claw-router/accounts/*/.claude.json`, routing throughput-safe work via `cr @litellm` (`deepseek-v4-pro` / `deepseek-flash`) and `cr @ollama` (`hybrid-coder` local GPU Ollama `qwen2.5-coder:14b`) while reserving Frontier subscription seats (`claude`, `codex`, `gemini` via `agy`) for OpenSpec authoring and Multi-Agent Decision Councils.

## 5. Saturated Every-Prompt 5-Phase Golden Path Nx TDD & Continuous Parallel Triad/Cross-Repo Sync Doctrine
- Every prompt across every host and repository executes in 5 deterministic phases:
  1. **Prompt Hydration (`MECH`) + Heavy Web Research**: 3-Tier MECH context hydration (`12/12` zero-miss dimensions, 1h `3600s` KV-cache prefix pinning) + SHA-256-pinned primary research.
  2. **Group Agent Conference Architecting with OpenSpec**: Frontier Architect group conference (`claude` + `codex` + `gemini`/`antigravity`, NEVER `opencode`) locking `openspec/changes/<change-id>/{proposal.md,design.md,tasks.md,specs/}`.
  3. **Homepage-First Deep UI Golden Path TDD & Massively Parallel Nx Implementation**: Golden Path TDD starting from `/` and testing deep 16-state OKLCH UI interactions across 6 breakpoints with `100%` unit test coverage and `90%+` E2E test coverage built to run in parallel via **Nx** (`nx.json`, `parallel: 8`).
  4. **Self-Expanding Recursive Recommendation Loop**: Ask for recommendations/next steps, span ideas across 2nd/3rd-order scope to cover everything in one prompt, and recursively implement 100% of them in the same turn until `0` remain.
  5. **Continuous Parallel Value-Absorption & Cross-Repository Documentation/Code Sync Agents**: Run parallel agents while the prompt and recommendation loops execute to absorb value into `heymegabyte/theme.tools`, `heymegabyte/install.doctor`, and `heymegabyte/agent-skills`, and keep documentation, code, and recommendations up-to-date across all sibling repositories.

## 6. Mail Deliverability (SPF / DKIM / DMARC / RFC 8058) & Gmail MCP Keychain Readiness
- **DNS Deliverability Posture (`megabyte.space`)**: Enforce live SPF (`v=spf1`), DKIM selector TXT records, DMARC (`_dmarc.<domain>` with `v=DMARC1; p=quarantine/reject`), and **RFC 8058 One-Click Unsubscribe** headers (`List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) on all outbound mail relays (`mail.megabyte.space`).
- **Gmail MCP Keychain Auto-Resolution (`gmail-mcp`)**: `paperclip-mcp-stdio-runner.mjs` resolves Claude OAuth credentials automatically from `~/.claude/.credentials.json`, `~/.config/agent-fleet/secrets/CLAUDE_OAUTH_ACCESS_TOKEN`, `~/.claw-router/accounts/*`, or the macOS Keychain (`security find-generic-password -s "Claude Code-credentials" -w`), enabling headless live inbox verification via `search_threads` and `get_message` (`messageFormat: "RAW"`).
