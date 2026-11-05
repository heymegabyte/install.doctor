---
name: "coolify-cluster-standard"
last_reviewed: 2026-11-05
superseded_by: null
priority: 2
pack: "infra"
triggers:
  - "coolify"
  - "omen.megabyte.space"
  - "legion.megabyte.space"
  - "zen.megabyte.space"
paths:
  - "*"
---

# Coolify Multi-Node Cluster & GPU Workload Standard (Pass-1 Mandate)

Whenever provisioning, onboarding, auditing, or modifying a Coolify server or multi-node workstation (`localhost` VM 100 `10.0.0.155`, `legion.megabyte.space` `10.0.0.143`, `omen.megabyte.space` `10.0.0.161`, `zen.megabyte.space` `10.0.0.162`), automatically apply all Wave-1, Wave-2, and Wave-3 pass-1 standards below without waiting for a "Top 30" audit prompt.

## 1. GPU & CPU Workload Placement & Offload (Wave 1 #1–#3, Wave 2 #14–#15, #17)
- **Never run CUDA/ROCm GPU workloads or heavy headless browsers on the CPU-only control plane (`VM 100`)**:
  - **ComfyUI (Wave 1 #1)**: Dedicate `omen.megabyte.space` (`10.0.0.161`, NVIDIA RTX 3080 Ti **16 GiB GDDR6X VRAM**) to `comfyui` (`/opt/comfyui/docker-compose.yml`, `gpus: all`, PyTorch 2.6+ CUDA 12.4), and route `comfy.megabyte.space` to `http://10.0.0.161:8188`.
  - **LiteLLM + Ollama (Wave 1 #2, Wave 2 #20)**: Route local LLM traffic via `routing_strategy: latency-based-routing` across **Legion** (`https://ollama-legion.megabyte.space`, RTX 4080 12 GiB) + **MacBook** (`https://ollama-macbook.megabyte.space`, M1 Pro 32 GiB) + the 4-key DeepSeek pool + Redis cache (`use_redis_transaction_buffer: true` in `general_settings` + `appendonly yes` on LiteLLM Redis).
  - **Immich CUDA Machine Learning Offload (Wave 2 #15)**: Run `ghcr.io/immich-app/immich-machine-learning:release-cuda` on `legion.megabyte.space` (`10.0.0.143:3003`, RTX 4080 12 GiB, `MACHINE_LEARNING_MODEL_TTL=120` so CLIP/facial-recognition models unload after 2m idle and never starve Ollama VRAM), and configure Immich `system-config.machineLearning.urls` to `["http://10.0.0.143:3003", "http://immich-machine-learning:3003"]` (GPU primary + local CPU fallback).
  - **Karakeep Headless Chrome Offload (Wave 2 #14)**: Run `karakeep-chrome-offload` (`zenika/alpine-chrome:123`, `10.0.0.143:9222`) on `legion.megabyte.space` and point `/opt/karakeep` `BROWSER_WEB_URL=http://10.0.0.143:9222` so headless Chromium spikes never hit `VM 100`.
  - **Remote BuildKit Builder (Wave 2 #17)**: Register `legion-builder` (`docker buildx create --name legion-builder --driver docker-container ssh://legion-buildkit`) on `VM 100` targeting `10.0.0.143` (32 threads, 61 GiB RAM).

## 2. Multi-Node Onboarding, SSH Reliability, Kernel Sysctls, & CI Runners (Wave 1 #4–#9, #19; Wave 2 #2–#3, #13, #16, #18–#19, #25, #28)
- **Workstation Onboarding & Laptop Sleep/Wi-Fi Guard (Wave 1 #4, Wave 2 #2, #16)**:
  - Onboard every workstation (`legion`, `omen`, `zen`) in Coolify with `user = coolify`, shared key `legion-coolify-ed25519` (`private_key_id = 3`), and LAN IP (`10.0.0.143`, `10.0.0.161`, `10.0.0.162`).
  - Always deploy `/etc/sysctl.d/99-coolify-production.conf` (`net.ipv4.ip_nonlocal_bind=1`, `vm.overcommit_memory=1`, `vm.swappiness=10`, `fs.file-max=2097152`, `fs.inotify.max_user_watches=524288`, `fs.inotify.max_user_instances=1024`, `net.core.somaxconn=4096`) and `ssh.service` `After=network-online.target` so `sshd` with `ListenAddress` never fails to bind Wi-Fi/LAN IPs at boot.
  - Always deploy `/etc/systemd/logind.conf.d/00-server-nosleep.conf` (`HandleLidSwitch=ignore`), mask `sleep.target suspend.target hibernate.target hybrid-sleep.target`, and set `/etc/NetworkManager/conf.d/default-wifi-powersave-off.conf` (`wifi.powersave = 2`).
- **Permanent `/data/coolify/ssh/keys` ACL & Permission Guard (Wave 2 #3)**:
  - Enforce `git -C /data/coolify config core.sharedRepository false`, install `/usr/local/bin/coolify-fix-ssh-perms` (`setfacl -b -R /data/coolify/ssh && chown -R 9999:root /data/coolify/ssh && chmod 700 /data/coolify/ssh /data/coolify/ssh/keys && chmod 600 /data/coolify/ssh/keys/ssh_key@*`), and hook it into `/data/coolify/.git/hooks/{post-commit,post-merge,post-checkout}` and `backup-commit.py` so git operations never add group `rwx` ACLs that make OpenSSH reject keys.
- **Standardized `ServerSettings` Across All Nodes (Wave 1 #5, #25; Wave 2 #13, #18, #19)**:
  - Enforce `is_sentinel_enabled = true`, `is_metrics_enabled = true`, `is_traffic_analytics_enabled = true`, `server_timezone = 'America/New_York'`, `wildcard_domain = 'https://megabyte.space'`, `generate_exact_labels = true`, `delete_unused_networks = true`, `patch_check_frequency = '0 4 * * *'`, `is_auto_security_updates_enabled = true`, and `is_logdrain_newrelic_enabled = false`.
- **Pull-Through Docker Registry Mirror (Wave 2 #28)**:
  - Configure `"registry-mirrors": ["https://registry.megabyte.space"]` in `/etc/docker/daemon.json` across all 4 cluster nodes (`VM 100`, `legion`, `omen`, `zen`).
- **Sysbox Ephemeral Runners & Pre-Baked Runner Image (Wave 1 #6–#9, #19)**:
  - Run `sysbox-runc` on `legion`, `omen`, and `zen` with `registry.megabyte.space/megabyte/coolify-runner:latest` and persist PHP overrides in `/data/coolify/source/overrides/`.

## 3. Edge Security, Traefik v3 CrowdSec Bouncer + AppSec WAF, & Resource Governance (Wave 1 #10–#18, #20; Wave 2 #4–#5, #8–#12, #29–#30)
- **Active CrowdSec Traefik Bouncer + AppSec WAF (Wave 1 #11–#12, Wave 2 #8)**:
  - Run `crowdsec` with `crowdsecurity/traefik`, `crowdsecurity/http-cve`, `crowdsecurity/wordpress`, `crowdsecurity/appsec-virtual-patching`, and `crowdsecurity/appsec-generic-rules` plus AppSec listener `:7422`.
  - Load `github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin` (`v1.3.5`) in `coolify-proxy` with `crowdsecMode: live`, `crowdsecLapiHost: crowdsec:8080`, and `crowdsecAppsecHost: crowdsec:7422` in `chain-default`.
- **Traefik `trustedIPs`, `tls.options.default`, & Bridge Network Attachment (Wave 2 #4–#5, #9–#10)**:
  - Set `forwardedHeaders.trustedIPs=127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` and `chmod 600 /data/coolify/proxy/acme.json`.
  - Define `tls.options.default` (`VersionTLS12`, AEAD cipher suites, `X25519`/`P-256`/`P-384`, `sniStrict: false`) in `/data/coolify/proxy/dynamic/00-default.yaml`.
  - Whenever `coolify-proxy` is recreated, run `/usr/local/bin/coolify-proxy-attach-networks` so `coolify-proxy` stays attached to every per-service bridge network.
  - Keep `/data/coolify/proxy/dynamic/` free of dead routers or standalone empty `http: {}` maps, and maintain legacy Healthchecks ping-key rewrite (`^/ping/csjKSM11DRvU5ZjHMmYxYg/(.*)$` -> `/ping/na09yvblsityte07tkgxfq/$1`) in `healthchecks-compat.yaml`.
- **Control Plane API Allowlist & Cloudflared Host Mode (Wave 2 #11–#12)**:
  - Populate `InstanceSettings.allowed_ips` (`127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,<Trusted-Egress-IP>/32`) and run `cloudflared` in `network_mode: host`.
- **Persisted Tiered Container Memory Limits & Healthchecks (Wave 1 #16–#17; Wave 2 #26, #29–#30)**:
  - Persist `mem_limit` (`4g` for `postgres*`/`database`/`coolify-db`/`litellm`/`authentik*`/`alloy`/`prometheus`/`loki`/`nexus`; `2g` for `coolify`/`coolify-sentinel`/`redis*`/`php-fpm`/`postiz`/`immich`/`grafana`; `1g` for standard apps) and `shm_size: 256mb` (for all Postgres containers) directly in all `docker-compose.yml` files on disk, and ensure `dockerproxy` includes a `/_ping` healthcheck.

## 4. Observability, Multi-Node GPU Telemetry, Redis/Postgres Tuning, & 3-2-1 Backups (Wave 1 #21–#24, #26–#30; Wave 2 #1, #6–#7, #21–#24, #26–#27)
- **Multi-Node Alloy + NVIDIA GPU Telemetry (Wave 1 #18, #21; Wave 2 #6, #26–#27)**:
  - Use `discovery.instrument` in `/opt/alloy/config.alloy` (`mem_limit: 4g`) on `VM 100`.
  - Run Grafana Alloy on `legion`, `omen`, and `zen` pushing host, cAdvisor, and `/usr/local/bin/export-nvidia-metrics` (`nvidia_gpu_*` textfile collector) metrics to `http://10.0.0.155:9090/api/v1/write` and logs to `http://10.0.0.155:3100/loki/api/v1/push`.
  - Connect `litellm` to `observability_default` with alias `litellm` and valid Bearer token in `/opt/observability/prometheus/litellm.key`.
- **Redis Eviction & Postgres Tuning + Continuous PITR WAL Archiving (Wave 1 #26–#28; Wave 2 #1, #7, #21–#24)**:
  - Configure `maxmemory 1536mb` (`allkeys-lru` for LiteLLM cache Redis, `volatile-lru` for queue/session Redis) across all Redis containers.
  - Tune `shared_buffers=256MB`, `effective_cache_size=1GB`, `maintenance_work_mem=128MB`, `work_mem=8MB`, `wal_compression=on`, `archive_mode=on`, and `archive_timeout=300s` across all 7 PostgreSQL containers, shipping WAL segments every 15m via `/data/coolify/scripts/pitr-wal-shipper.py` to Cloudflare R2 (`tag=pitr-wal`).
  - Cap local backup retention `database_backup_retention_amount_locally = 7` across all `ScheduledDatabaseBackup` rows, and keep `/usr/local/bin/coolify-sync-nocodb-sqlite` active so NocoDB's SQLite database is mirrored into Postgres before scheduled backups.
  - Reconcile `StandalonePostgresql::find(0)` (`coolify-db`) metadata (`postgres:15-alpine`, `running:healthy`, `limits_memory = '4g'`).

## 5. Wave-3 Self-Healing, Database/Runtime Tuning, & Zero-False-Alert Discipline (Wave 3 #1–#36)
- **CrowdSec `acquis.yaml` Compatibility & Traefik v3.7 Hygiene (Wave 3 #1–#3, #11–#12, #32)**:
  - Never add `namespace:` keys inside `/opt/crowdsec/config/acquis.yaml` for `source: appsec` (unsupported in CrowdSec v1.7.x; causes crash-loop).
  - Run `traefik:v3.7` on `coolify-proxy`, keep `/data/coolify/proxy` free of POSIX ACLs (`setfacl -b -R /data/coolify/proxy && chmod 600 /data/coolify/proxy/acme.json` inside `/usr/local/bin/coolify-fix-ssh-perms`), sync `Server::find(0)->proxy['last_saved_settings']` and `last_applied_settings` to `md5sum /data/coolify/proxy/docker-compose.yml`, and run `/usr/local/bin/coolify-proxy-watchdog` every 2m.
- **JVM, Go (`GOMEMLIMIT`), LiteLLM, MariaDB, PHP-FPM, Postgres, & Redis Deep Tuning (Wave 3 #8–#10, #14–#15, #19, #22–#23, #33–#34)**:
  - **Nexus 3**: Bound JVM heap & direct memory (`-Xms1024m -Xmx1536m -XX:MaxDirectMemorySize=1024m -XX:MaxMetaspaceSize=256m -XX:+UseG1GC`).
  - **Grafana Alloy**: Set `GOMEMLIMIT=3000MiB` and scope `beyla.ebpf` `open_ports` to active HTTP/RPC ports (`80,443,2283,3000,3001,4000,5000,8000,8080,8081,9000`).
  - **MariaDB & PHP-FPM**: Enforce `/etc/mysql/conf.d/99-coolify-tuning.cnf` (`innodb_buffer_pool_size=512M`, `slow_query_log=1`, `long_query_time=1.0`), `pm.max_requests = 500`, and `opcache.memory_consumption = 256` (`99-coolify-opcache.ini`).
  - **Postgres & Redis**: Enforce `track_io_timing=on`, `log_min_duration_statement=1000`, `idle_in_transaction_session_timeout=5min`, `statement_timeout=15min`, weekly `VACUUM (ANALYZE)` cron (`/etc/cron.d/coolify-postgres-vacuum`), and Redis `tcp-keepalive 60` + `hz 15` (`redis:7.4-alpine` / `postgres:16-alpine`).
- **Worker Node GPU Persistence, Autoheal, Journald Caps, & Zero-Alert Drift (Wave 3 #5–#7, #16–#18, #21, #24–#31, #35)**:
  - Enable `nvidia-smi -pm 1` (`nvidia-persistenced`) and `willfarrell/autoheal:1.2.0` on `legion` and `omen`.
  - Cap `systemd-journald` (`SystemMaxUse=1G`) across all 4 nodes (`VM 100`, `legion`, `omen`, `zen`).
  - Keep `DECOMMISSIONED_PREFIXES` updated in `/data/coolify/scripts/restore-drill.py`, `dump_all = false` on NocoDB backup (`id=8`), `--update-baseline` after image upgrades in `/data/coolify/scripts/image-scan.py`, and provision `/opt/observability/grafana/dashboards/estate/coolify-cluster-gpu.json` + GPU Prometheus alert rules (`NvidiaGpuHighMemory`, `NvidiaGpuHighTemperature`).

## 6. Explicit Negative Blocklist (Wave 1 #29 Excluded)
- **Do NOT deploy Diun or pin floating `:latest` tags**: The estate intentionally uses rolling `:latest` tags with automated updates; never recommend or deploy Diun or replace `:latest` tags with static digests unless explicitly asked.
