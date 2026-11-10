---
title: Server ingress ownership
description: Defines which layer owns Cloudflare Tunnel ingress, host firewall defaults, per-host exceptions, and live Cloudflare state.
sidebar_label: Server ingress ownership
slug: /architecture/server-ingress-ownership
---

# Server ingress ownership

Server networking is split into four layers. Each fact has one owner; downstream layers consume it without redefining it.

| Layer | Owns | Must not own |
|---|---|---|
| Agent skills | Policy: Tunnel-first ingress, enabled default-deny inbound firewall, explicit least-privilege exceptions, verification requirements | Executable machine configuration or host-specific ports |
| Desktop Tools | Portable mechanisms: typed `cloudflared` configuration and selected firewall package delivery; host-firewall policy convergence is currently unsupported and fails closed | Cloudflare account topology, production DNS names, origin mappings, permanent host-specific exceptions, or unjournaled firewall mutation |
| Host recovery repo | Desired state for one machine: tunnel identity reference, ingress hostnames/services, Access intent, firewall exception manifest, rollback and recovery commands | Universal package-install logic or undocumented dashboard-only state |
| Cloudflare control plane and live host | Reconciled runtime state and observed evidence | Source-of-truth configuration edited only in a dashboard |

## Install Doctor contract

Desktop Tools provides capabilities, not estate topology. Current shipped status:

- The selected package plan may install `cloudflared` and an explicitly selected firewall package where the platform catalog supports it.
- The typed `cloudflared` hook can check, apply, and verify its bounded connector configuration.
- Automatic UFW, Docker-chain, Fail2ban, and macOS Application Firewall mutation is unavailable. The legacy writer fails with status 20 and does not retrieve sudo credentials or alter host state.
- A future firewall operation must snapshot exact policy and service state, preserve the active management path, arm a bounded recovery action, verify allowed and denied paths, and prove rollback reachability before this capability can be advertised as supported.
- Accept host-owned desired state or secret references as inputs. Never generate production hostname, port, Access-policy, or exception decisions from a generic machine role.
- Do not open ports merely because software was installed. Package presence is not authorization for ingress.

## Host-repo contract

Every server or host repo records:

- Tunnel name/ID reference and secret-resolution key—not the token itself.
- One ingress entry per hostname and origin service, with origins bound to loopback, a container network, or an explicitly justified private interface.
- Cloudflare Access application/policy intent for every protected surface.
- Firewall exceptions as reviewable records containing purpose, owner, protocol, exact port/range, narrow source/interface, exposure class, expiry/review condition, removal command, and positive/negative tests.
- A reconciliation script that applies Cloudflare and firewall desired state idempotently.
- A recovery path and an observed-state capture that can detect dashboard or host drift.

## Reconciliation and verification

The intended future reconciliation order is: install mechanisms → establish Tunnel → verify the private origin → apply host declarations → enable default-deny firewall with an armed rollback → verify from allowed and denied paths → cancel rollback → remove bootstrap access. The current release stops before firewall mutation.

Promotion of firewall convergence requires evidence that:

- `cloudflared` and the firewall enabled after reboot.
- No unintended listener on a public interface.
- Cloudflare DNS, Tunnel ingress, and Access match the host declaration.
- Every exception passes from an allowed source and fails from a denied source.
- Dashboard-only drift is either imported into the host repo or removed.

This document defines ownership. The agent-skills rule defines enforcement; host recovery repositories define estate-specific desired state.
