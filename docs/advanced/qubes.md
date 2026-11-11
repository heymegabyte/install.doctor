---
title: Qubes evidence and customization
description: Understand the Qubes fixture boundary, historical desired state, and prerequisites for real-host support.
sidebar_label: Qubes
slug: /advanced/qubes
---

Desktop Tools contains Qubes-specific desired-state history and strict disposable-lab contracts for
dom0, TemplateVM, AppVM, DisposableVM, Whonix, and qrexec. **Qubes is not currently a published or
verified platform support cell.** Do not run a retired Install Doctor URL in dom0 expecting the
Desktop Tools lifecycle.

The authoritative support claim is in `scripts/platform-support-matrix.json`. Qubes remains
unsupported until a fresh independently attested canary proves the complete signed bootstrap,
reviewed plan, apply, verify, unchanged reapply, interruption/resume, rollback, and headless lifecycle
for the exact Qubes version and release.

## What is implemented

The repository currently verifies two bounded layers:

1. `qubes-fixture-contract.ts` defines strict compartment identity, template relationships,
   networking, persistent-root behavior, exact qrexec rules, and evidence-bound mutation admission.
2. `qubes-native-lifecycle.ts` exercises typed dom0 policy, template package, AppVM configuration,
   DisposableVM run/teardown, and Whonix Gateway/Workstation configuration in a disposable in-memory
   fixture.

Every fixture operation crosses an exact qrexec service tuple and intersects source authority, rule
authority, and target acceptance. The lifecycle schema exposes no command or generic-shell field.
Offline plans require `networkPolicy: "deny"`, embedded package artifact digests, current independently
verified fixture evidence, and teardown of each DisposableVM created by the plan.

Developers can verify this boundary without contacting a Qubes host:

```bash
cd packages/installer-engine
npm run build
node --test test/qubes-fixture-contract.test.mjs test/qubes-native-lifecycle.test.mjs
```

Passing these tests means **fixture-verified**, not installed, live, or production-supported.

## Historical desired state

The Chezmoi tree retains Qubes-specific templates and scripts because existing installations may
depend on them. Historical behavior includes desired dom0 packages, official and unofficial template
lists, Whonix templates, a provision qube, Mirage firewall material, minimal-template sudo policy,
and optional sys-gui GPU configuration. These files are migration inputs, not evidence that the new
Desktop Tools engine owns or has safely executed those effects.

Do not delete, rewrite, or automatically execute that state during migration. Each effect must first
gain:

- an exact typed operation and immutable inputs;
- preconditions, postconditions, locks, timeout, cancellation, and journal semantics;
- qrexec policy with no wildcard service, source, target, argument, or authority;
- interruption, unchanged-reapply, rollback-limit, and legacy-subtraction tests;
- an authorized disposable or dedicated Qubes canary receipt.

## Security rules

- Keep dom0 network-isolated. Downloading a bootstrap directly in dom0 is not an approved design.
- Move bytes only through a named, least-privilege qrexec service from an identified compartment.
- Never translate profile input into `qvm-run`, `qubesctl`, shell text, paths, or qrexec policy.
- Template mutation must target an exact TemplateVM and immutable package artifact.
- AppVM authority never implies template, dom0, Whonix Gateway, or another AppVM authority.
- Whonix Workstation networking must remain bound to the Whonix Gateway path; an ordinary NetVM is
  not an equivalent configuration.
- Disposable execution must leave no persistent root or active disposable instance after the plan.
- Offline evidence must show zero network attempts; a cached artifact is not permission to fetch.

## Real-host promotion prerequisites

Before publishing a Qubes entrypoint, operators must provide an authorized non-daily-driver fixture or
dedicated canary, pin the Qubes release and templates, provision the exact qrexec policy, independently
verify the signed release, and retain target-bound lifecycle receipts. Destructive dom0, template,
network, storage, and sys-gui changes need separate approval and rollback procedures.

If a prerequisite is absent, report the cell as `BLOCKED` or `UNVERIFIED`; do not fall back to the
legacy URL, generic shell execution, direct dom0 networking, or another platform's receipt.

See the [implementation and verification runbook](/docs/desktop-tools/implementation-runbook) and
[platform support matrix](/docs/aid/platform-support) for the repository-wide evidence rules.
