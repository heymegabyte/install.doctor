# Design

> **Architect:** codex
> **Architect Role:** assigned

## Context

Install Doctor already ships KasmVNC fit and bridge helpers, but its post-install hook only acts when KasmVNC happens to exist and copies a Legion-named runner. Omen proved a complete reusable chain: live GNOME RFB source, native KasmVNC bridge, persistent browser CDP, sanitized inventory, health checks, and DR evidence.

## Goals / Non-Goals

**Goals:** automatically reconcile the reusable chain on eligible hosts; preserve loopback-only security; remain idempotent and testable without installation side effects in CI.

**Non-Goals:** create Cloudflare DNS/Access applications without host identity, copy credentials, force desktop provisioning on servers/containers, or install host-specific AI/runner workloads.

## Decisions

- Gate on Linux, configured GNOME desktop, non-container environment, and measured total RAM ≥16 GiB. `INSTALL_DOCTOR_KASMVNC=0` opts out; `=1` permits an explicit eligible-host reconciliation.
- Use neutral `desktop-*` service names and configurable ports (defaults 5900, 6901, 5920, and 9222). The provisioner's brand never appears in runtime service identity.
- Keep origin services loopback-only and leave Cloudflare hostname/tunnel creation to the host repo.
- Generate secrets locally with mode 0600; never serialize them into Install Doctor or snapshots.
- Treat absent sudo as a reported privileged prerequisite, not permission to weaken or fake the installation.

## Risks / Trade-offs

- [Distribution package variance] → verify required binaries and report precise prerequisites; keep installation idempotent.
- [Active desktop geometry varies] → derive from monitors.xml with a safe fallback and browser-local scaling.
- [Existing host units differ] → do not delete them; install generic units, verify, then allow the host repo to migrate deliberately.
- [CDP is sensitive] → bind only to 127.0.0.1 and never create public ingress automatically.

## Migration Plan

Add failing contract tests, generalize helpers, implement the reconciler, run repository tests, apply on Omen alongside existing units, verify equivalent loopback endpoints, then migrate only after proof. Rollback disables generic user units without removing host-specific services or profiles.
