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
| Install Doctor | Portable mechanisms: install `cloudflared` and a supported firewall, enable their services, apply safe default policies, expose idempotent commands and verification | Cloudflare account topology, production DNS names, origin mappings, or permanent host-specific exceptions |
| Host recovery repo | Desired state for one machine: tunnel identity reference, ingress hostnames/services, Access intent, firewall exception manifest, rollback and recovery commands | Universal package-install logic or undocumented dashboard-only state |
| Cloudflare control plane and live host | Reconciled runtime state and observed evidence | Source-of-truth configuration edited only in a dashboard |

## Install Doctor contract

Install Doctor provides capabilities, not estate topology:

- Install `cloudflared`, `ufw` or `firewalld`, and their service dependencies for applicable roles.
- Keep `setup-firewall` idempotent: allow outbound, deny unsolicited inbound, preserve established traffic, enable the firewall, and report the resulting policy.
- Keep the cloudflared post-install hook able to install, enable, start, and health-check the connector service.
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

Provision in this order: install mechanisms → establish Tunnel → verify the private origin → apply host declarations → enable default-deny firewall → verify from allowed and denied paths → remove bootstrap access.

Completion requires:

- `cloudflared` and the firewall enabled after reboot.
- No unintended listener on a public interface.
- Cloudflare DNS, Tunnel ingress, and Access match the host declaration.
- Every exception passes from an allowed source and fails from a denied source.
- Dashboard-only drift is either imported into the host repo or removed.

This document defines ownership. The agent-skills rule defines enforcement; host recovery repositories define estate-specific desired state.
