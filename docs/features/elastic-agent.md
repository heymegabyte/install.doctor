---
title: Elastic Agent (ELK) Integration
description: Learn how Install Doctor enrolls hosts into an Elastic Fleet Server so that system and application logs are shipped to the ELK stack for centralized search and alerting.
sidebar_label: Elastic Agent
slug: /integrations/elastic-agent
---

Install Doctor can enroll provisioned hosts into an [Elastic Fleet Server](https://www.elastic.co/guide/en/fleet/current/fleet-overview.html) so that logs and metrics land in Elasticsearch and can be searched, alerted on, and retained centrally in Kibana.

Unlike a locally configured log shipper, Elastic Agent is **policy-managed**: the agent enrolls once with an enrollment token, and the Fleet policy in Kibana decides which integrations (System, Docker, Nginx, custom logs, …) run on the host. This is why provisioning only needs to enroll the agent — changing what is collected afterwards is a Kibana-side change that requires no re-provisioning.

## How Enrollment Works

The enrollment step lives in [`home/.chezmoiscripts/universal/run_after_26-elastic-agent.sh.tmpl`](https://github.com/heymegabyte/install.doctor/blob/master/home/.chezmoiscripts/universal/run_after_26-elastic-agent.sh.tmpl) and runs on every `chezmoi apply`. It is additive, idempotent, and best-effort:

1. Skips unless `elastic-agent` is actually installed (`PATH`, `/Library/Elastic/Agent`, `/opt/Elastic/Agent`, or `/usr/share/elastic-agent`).
2. Skips unless the enrollment token is available as an encrypted secret or an environment variable.
3. Skips when the agent is already enrolled against the same Fleet Server with the same token. The enrollment fingerprint (a SHA-256 digest of Fleet URL + CA fingerprint + token) is recorded in `~/.local/state/install-doctor/elastic-agent.enrollment`; the token itself is never stored.
4. Re-enrolls with `--force` when the token, Fleet URL, or CA fingerprint changes, or when `ELASTIC_AGENT_REENROLL=1` is set. An agent that was enrolled by other means is adopted as-is rather than reinstalled.

Enrollment failures (Fleet Server unreachable, token rejected, no passwordless `sudo`) are logged as warnings and never abort `chezmoi apply`.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `ELASTIC_TOKEN` | Yes | Fleet **enrollment token** (Fleet → Enrollment tokens). Read from `home/.chezmoitemplates/secrets/ELASTIC_TOKEN`, `secrets-<hostname>/ELASTIC_TOKEN`, or the environment. |
| `ELASTIC_FLEET_SERVER` | No | Fleet Server URL. Defaults to `https://es-fleet.megabyte.space:8220`; override it in `home/.chezmoi.yaml.tmpl` (`host.elastic_fleet_server`) or as an environment variable at first provision. |
| `ELASTIC_FLEET_CA_FINGERPRINT` | No | SHA-256 CA fingerprint for Fleet Server certificates that are not in the system trust store. Prefer this over `--insecure`; TLS verification is never disabled by this script. |
| `LOGSTASH_SYSLOG_SERVER` | No | `host:port` of a Logstash `syslog` input. When set on a host with rsyslog, `*.*` is forwarded over TCP and the configuration is validated with `rsyslogd -N1` before rsyslog is restarted. Unset removes the managed drop-in again. |
| `INSTALL_DOCTOR_ELASTIC_AGENT` | No | Set to `0` to skip enrollment entirely. |
| `ELASTIC_AGENT_REENROLL` | No | Set to `1` to force re-enrollment even when the fingerprint matches. |

## Setup Steps

1. In Kibana, open **Fleet → Enrollment tokens** and copy the token for the policy that should apply to the host.
2. Store it as an encrypted secret:

```shell
echo -n "YOUR_ENROLLMENT_TOKEN" | chezmoi encrypt > home/.chezmoitemplates/secrets/ELASTIC_TOKEN
```

3. Make sure the software selection installs the agent (the enrollment step never installs packages itself).
4. Run `chezmoi apply` and confirm the host appears under **Fleet → Agents** in Kibana.

## Syslog to ELK

The default Fleet policy integration (`system`) collects journald/syslog on most distributions, so no extra configuration is required for standard host logs. Hosts that must feed a legacy syslog pipeline (for example network devices or applications that speak RFC 3164/5424 to a Logstash `syslog` input) can set `LOGSTASH_SYSLOG_SERVER`:

```shell
export LOGSTASH_SYSLOG_SERVER="logstash.example.com:5514"
```

The generated drop-in is `/etc/rsyslog.d/60-elastic-syslog.conf`, is marked as managed, and is only written when the value is a plain `host` or `host:port` — anything else is rejected so that a malformed variable cannot inject rsyslog configuration.

## Verifying Enrollment

| Check | Command |
|---|---|
| Agent status | `sudo elastic-agent status` |
| Enrolled Fleet Server and policy | Kibana → **Fleet → Agents** |
| Recorded fingerprint | `cat ~/.local/state/install-doctor/elastic-agent.enrollment` |
| Syslog forwarding (if configured) | `sudo rsyslogd -N1` and `grep -F '*.* @@' /etc/rsyslog.d/60-elastic-syslog.conf` |
| Logs in Elasticsearch | `GET logs-*/_search` for the host's `host.name` |
