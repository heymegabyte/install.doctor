# Proposal

> **Architect:** codex
> **Architect Role:** assigned

## Why

Reusable infrastructure learned while configuring Omen was left partly in a host repository even though Install Doctor is the estate-wide provisioning source of truth. Eligible Linux workstations need one automatic, recoverable live-GNOME KasmVNC baseline rather than hostname-specific copies.

## What Changes

- Automatically provision the native live-GNOME KasmVNC bridge on configured Linux desktops with at least 16 GiB RAM.
- Generalize existing KasmVNC helpers by removing Legion-specific paths, ports, markers, and aliases.
- Generate user services and credentials without copying host secrets, while keeping all VNC/KasmVNC listeners loopback-only.
- Keep the browser gateway alive across physical GNOME logout/reload and closed-lid operation, reconnecting to the live session when GNOME returns.
- Incorporate Omen's persistent browser, sanitized inventory, health, and recovery patterns as reusable optional host operations.
- Harden the universal firewall hook so every supported host verifies actual enforcement, not merely an active service, and remove Legion-specific exceptions from shared logic.
- Update agent doctrine so every reusable live-host infrastructure change is upstreamed to Install Doctor in the same turn.

## Capabilities

### New Capabilities

- `live-gnome-remote-desktop`: Eligibility, provisioning, security, service, verification, and recovery behavior for the universal KasmVNC live-desktop baseline.

### Modified Capabilities

- `default-provisioning-policy`: Eligible ≥16 GiB Linux desktops automatically receive the remote-desktop baseline.

## Impact

Touches Install Doctor post-install hooks, KasmVNC runners, user systemd units, host inventory/health helpers, tests, and provisioning doctrine. Hostnames, Cloudflare tunnel identities, Access policies, and credentials remain host-repository responsibilities.
