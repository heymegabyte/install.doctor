# Coolify Multi-Node Cluster & GPU Workload Standard

This document codifies the pass-1 architecture and hardening baseline for the Coolify multi-node cluster (`coolify.megabyte.space` VM 100 `10.0.0.155`, `legion.megabyte.space` `10.0.0.143`, `omen.megabyte.space` `10.0.0.161`, and `zen.megabyte.space` `10.0.0.162`).

## Pass-1 Checklist
1. **Dedicated GPU Placement (#1, #2)**:
   - `omen.megabyte.space` (`10.0.0.161`, RTX 3080 Ti 16 GiB VRAM) runs `comfyui` (`/opt/comfyui/docker-compose.yml`) backing `comfy.megabyte.space`.
   - `legion.megabyte.space` (`10.0.0.143`, RTX 4080 12 GiB VRAM) and MacBook M1 Pro (32 GiB) back LiteLLM (`latency-based-routing`) alongside the 4-key DeepSeek pool.
   - `VM 100` (`10.0.0.155`) never runs CPU-fallback `comfyui` or `ollama`.
2. **Multi-Node Onboarding & Sentinel (#4, #5, #25)**:
   - All nodes authenticate via `user = coolify` and `private_key_id = 3` (`legion-coolify-ed25519`) over LAN (`10.0.0.0/24`) with Sentinel metrics (`is_metrics_enabled = true`) and Traefik traffic analytics (`is_traffic_analytics_enabled = true`).
3. **Sysbox Ephemeral GitHub Runners (#6, #7, #8, #9, #19)**:
   - `sysbox-ce` (`sysbox-runc`) is installed on `legion`, `omen`, and `zen`.
   - `github_runner_configs` use `docker_mode = "sysbox"`, `runner_image = "registry.megabyte.space/megabyte/coolify-runner:latest"`, and per-host CPU/RAM caps (`12c/20g` on Legion, `8c/12g` on Omen, `6c/8g` on Zen).
   - Coolify PHP overrides (`GithubRunnerApi.php`) are persisted via `/data/coolify/source/docker-compose.custom.yml`.
4. **Security, Observability, & 3-2-1 DR (#10–#18, #20–#24, #26–#28, #30)**:
   - `DOCKER-USER` firewall guard in `/etc/ufw/after.rules`, CrowdSec reading `/data/coolify/proxy/access.log`, WordPress Traefik middleware (`/data/coolify/proxy/dynamic/wordpress-security.yaml`), and `traefik:v3.7` across all nodes.
   - Unified `alloy` with `beyla.ebpf` auto-instrumentation, tuned `grafana-renderer` (`shm_size: 1gb`), and pre-filtered `grafana-alert-gate.py`.
   - Full `/opt` stack restic coverage (`volume-backup.py`), Wasabi 3-2-1 offsite sync (`wasabi-offsite-sync.py`), Postgres continuous WAL archiving (`pitr-wal-shipper.py`), and Infisical Cloud secret sync (`infisical-cloud-sync.py`).
5. **Exclusions**:
   - Do not deploy Diun or pin floating `:latest` tags (#29).
   - Keep `immich-machine-learning` placement (#3) user-directed.
