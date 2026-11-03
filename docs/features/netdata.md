---
title: Netdata Integration
description: Learn about how Install Doctor integrates Netdata to provide a free, cloud-hosted dashboard where you can view charts and metrics that cover all your most important device metrics.
sidebar_label: Netdata
slug: /integrations/netdata
---

Install Doctor integrates [Netdata](https://www.netdata.cloud/) to provide real-time system monitoring with a detailed, interactive dashboard. The free cloud service lets you monitor all your provisioned devices from a single web interface.

<figure>
  <picture>
    <source src="/docs/screenshots/netdata-localhost.png" type="image/png" />
    <source src="/docs/screenshots/netdata-localhost.webp" type="image/webp" />
    <img src="/docs/screenshots/netdata-localhost.png" alt="Netdata localhost screenshot" loading="eager" />
  </picture>
  <figcaption>Screenshot of the localhost version of Netdata (i.e. http://localhost:19999)</figcaption>
</figure>

## What Gets Monitored

Netdata collects hundreds of metrics out of the box:

| Category | Metrics |
|---|---|
| **CPU** | Usage per core, load average, context switches, interrupts |
| **Memory** | RAM usage, swap, page faults, kernel memory |
| **Disk** | I/O throughput, latency, space usage per mount |
| **Network** | Bandwidth per interface, packets, errors, drops |
| **Processes** | Running, sleeping, zombie processes, fork rate |
| **Services** | Docker containers, systemd units, web servers |
| **Applications** | Per-application CPU, memory, and I/O usage |

## Configuration

| Variable | Required | Description |
|---|---|---|
| `NETDATA_TOKEN` | For cloud | The `--claim-token` value from [Netdata Cloud](https://app.netdata.cloud) |
| `NETDATA_ROOM` | For cloud | The `--claim-rooms` value shown when creating a new room |

Without these variables, Netdata still installs and runs locally at `http://localhost:19999`. With the variables, your device is automatically enrolled in Netdata Cloud for centralized monitoring.

### Setup Steps

1. Create a free account at [Netdata Cloud](https://app.netdata.cloud)
2. Create a new Room (or use the default)
3. Click **"Connect Nodes"** and copy the `--claim-token` and `--claim-rooms` values
4. Store them as encrypted secrets:

```shell
echo -n "YOUR_CLAIM_TOKEN" | chezmoi encrypt > home/.chezmoitemplates/secrets/NETDATA_TOKEN
echo -n "YOUR_ROOM_ID" | chezmoi encrypt > home/.chezmoitemplates/secrets/NETDATA_ROOM
```

5. Re-provision or run `chezmoi apply` to connect

## Alerts

Netdata supports automated alerts when system parameters exceed defined thresholds. Install Doctor includes a pre-configured [notification configuration](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/netdata/health_alarm_notify.conf.tmpl) that supports:

| Notification Method | Required Secret |
|---|---|
| Email (SMTP) | SMTP credentials in secrets |
| Slack | `SLACK_API_TOKEN` |
| PagerDuty | PagerDuty integration key |
| Custom webhooks | Webhook URL |

For full details on configuring alerts, see [Netdata's alert documentation](https://learn.netdata.cloud/docs/alerts-and-notifications/configure-alerts).

## Access Methods

| Method | URL | Description |
|---|---|---|
| Local dashboard | `http://localhost:19999` | Always available when Netdata is running |
| Netdata Cloud | `https://app.netdata.cloud` | Centralized view of all enrolled devices |
| Private tunnel + local | `http://private-host:19999` | Access through an explicitly configured private tunnel |
