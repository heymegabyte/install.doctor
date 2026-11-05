# Coolify Multi-Node Cluster & GPU Workload Standard (Pass-1 Mandate)

Whenever provisioning, onboarding, auditing, or modifying a Coolify server or multi-node workstation (`localhost` VM 100 `10.0.0.155`, `legion.megabyte.space` `10.0.0.143`, `omen.megabyte.space` `10.0.0.161`, `zen.megabyte.space` `10.0.0.162`), automatically apply all Wave-1 and Wave-2 pass-1 standards below without waiting for a "Top 30" audit prompt.

## 1. GPU & CPU Workload Placement & Offload (Wave 1 #1–#3, Wave 2 #14–#15, #17)
- **ComfyUI (Wave 1 #1)**: Dedicate `omen.megabyte.space` (`10.0.0.161`, NVIDIA RTX 3080 Ti **16 GiB GDDR6X VRAM**) to `comfyui` (`/opt/comfyui/docker-compose.yml`, `gpus: all`, PyTorch 2.6+ CUDA 12.4), and route `comfy.megabyte.space` to `http://10.0.0.161:8188`.
- **LiteLLM + Ollama (Wave 1 #2, Wave 2 #20)**: Route local LLM traffic via `routing_strategy: latency-based-routing` across **Legion** (`https://ollama-legion.megabyte.space`, RTX 4080 12 GiB) + **MacBook** (`https://ollama-macbook.megabyte.space`, M1 Pro 32 GiB) + the 4-key DeepSeek pool + Redis cache (`use_redis_transaction_buffer: true` in `general_settings` + `appendonly yes` on LiteLLM Redis).
- **Immich CUDA Machine Learning Offload (Wave 2 #15)**: Run `ghcr.io/immich-app/immich-machine-learning:release-cuda` on `legion.megabyte.space` (`10.0.0.143:3003`, RTX 4080 12 GiB, `MACHINE_LEARNING_MODEL_TTL=120`), and configure Immich `system-config.machineLearning.urls` to `["http://10.0.0.143:3003", "http://immich-machine-learning:3003"]`.
- **Karakeep Headless Chrome Offload (Wave 2 #14)**: Run `karakeep-chrome-offload` (`zenika/alpine-chrome:123`, `10.0.0.143:9222`) on `legion.megabyte.space` and point `/opt/karakeep` `BROWSER_WEB_URL=http://10.0.0.143:9222`.
- **Remote BuildKit Builder (Wave 2 #17)**: Register `legion-builder` (`docker buildx create --name legion-builder --driver docker-container ssh://legion-buildkit`) on `VM 100`.

## 2. Multi-Node Onboarding, SSH Reliability, Kernel Sysctls, & CI Runners (Wave 1 #4–#9, #19; Wave 2 #2–#3, #13, #16, #18–#19, #25, #28)
- **Workstation Onboarding & Laptop Sleep/Wi-Fi Guard (Wave 1 #4, Wave 2 #2, #16)**:
  - Deploy `/etc/sysctl.d/99-coolify-production.conf` (`net.ipv4.ip_nonlocal_bind=1`, `vm.overcommit_memory=1`, `vm.swappiness=10`, `fs.file-max=2097152`, `fs.inotify.max_user_watches=524288`, `fs.inotify.max_user_instances=1024`, `net.core.somaxconn=4096`) and `ssh.service` `After=network-online.target`.
  - Deploy `/etc/systemd/logind.conf.d/00-server-nosleep.conf` (`HandleLidSwitch=ignore`), mask `sleep.target suspend.target hibernate.target hybrid-sleep.target`, and set `/etc/NetworkManager/conf.d/default-wifi-powersave-off.conf` (`wifi.powersave = 2`).
- **Permanent `/data/coolify/ssh/keys` ACL & Permission Guard (Wave 2 #3)**:
  - Enforce `git -C /data/coolify config core.sharedRepository false` and `/usr/local/bin/coolify-fix-ssh-perms` via git hooks and `backup-commit.py`.
- **Standardized `ServerSettings` & Registry Mirror (Wave 2 #13, #18, #19, #28)**:
  - Enforce `America/New_York` timezone, `https://megabyte.space` wildcard domain, `generate_exact_labels = true`, `delete_unused_networks = true`, `is_auto_security_updates_enabled = true`, `is_logdrain_newrelic_enabled = false`, and `"registry-mirrors": ["https://registry.megabyte.space"]` across all 4 nodes.

## 3. Edge Security, Traefik v3 CrowdSec Bouncer + AppSec WAF, & Resource Governance (Wave 1 #10–#18, #20; Wave 2 #4–#5, #8–#12, #29–#30)
- **Active CrowdSec Traefik Bouncer + AppSec WAF (Wave 2 #8)**:
  - Run `crowdsec` with AppSec `:7422` and `github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin` (`v1.3.5`) in `chain-default`.
- **Traefik `trustedIPs`, `tls.options.default`, & Bridge Network Attachment (Wave 2 #4–#5, #9–#10)**:
  - Set `forwardedHeaders.trustedIPs=127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`, `tls.options.default`, and run `/usr/local/bin/coolify-proxy-attach-networks` whenever `coolify-proxy` restarts.
- **Persisted Tiered Container Memory Limits & Healthchecks (Wave 2 #24, #29–#30)**:
  - Persist `mem_limit` (`4g` DB/AI/observability, `2g` control-plane/Redis/PHP/Immich, `1g` apps) and `shm_size: 256mb` (Postgres) in all `docker-compose.yml` files.

## 4. Observability, Multi-Node GPU Telemetry, Redis/Postgres Tuning, & 3-2-1 Backups (Wave 1 #21–#24, #26–#30; Wave 2 #1, #6–#7, #21–#24, #26–#27)
- **Multi-Node Alloy + NVIDIA GPU Telemetry (Wave 2 #6, #26–#27)**:
  - Use `discovery.instrument` in `/opt/alloy/config.alloy` (`mem_limit: 4g`) on `VM 100` and run Alloy + `/usr/local/bin/export-nvidia-metrics` on `legion`, `omen`, and `zen`.
- **Redis Eviction & Postgres Tuning + Continuous PITR WAL Archiving (Wave 2 #1, #7, #21–#24)**:
  - Configure `maxmemory 1536mb` across all Redis containers, tune `shared_buffers=256MB` / `effective_cache_size=1GB` / `archive_mode=on` across all 7 Postgres containers, ship WAL segments every 15m via `/data/coolify/scripts/pitr-wal-shipper.py`, cap local backup retention to 7, and sync NocoDB SQLite into Postgres before backups.
