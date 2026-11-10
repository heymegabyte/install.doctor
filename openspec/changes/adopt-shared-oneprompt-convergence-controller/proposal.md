# Proposal: adopt the shared OnePrompt convergence controller

**Architect:** codex
**Architect Role:** assigned

## Why

The completed `provision-oneprompt-convergence-supervisor` change established a safe, inert launchd/systemd adapter, but it predates OnePrompt's repository-native SQLite controller. It uses the legacy `com.heymegabyte.oneprompt-convergence` label plus separate pause, stop, and heartbeat files, while OnePrompt now uses `tools.theme.oneprompt.converge` and `state.sqlite`. Two desired-state authorities can disagree and two installed labels can wake competing writers.

The linked theme.tools change `extract-portable-convergence-control-plane` moves the reusable controller into `@theme.tools/workflows`. `install.doctor` must adopt that contract without overwriting the completed supervisor history, disturbing extensive unrelated dirty work, or starting live convergence as an installation side effect.

## What Changes

- Evolve the existing OnePrompt supervisor as a follow-up to delegate controller state operations to the OnePrompt CLI backed by the pinned shared `@theme.tools/workflows/convergence` artifact.
- Manage exactly one actual service identity, `tools.theme.oneprompt.converge`, on launchd and systemd while retaining install.doctor ownership of paths, definitions, lifecycle, and manager observations.
- Reconcile the legacy label and file-based intent into the canonical SQLite database through an explicit, recoverable adoption operation that never weakens pause/stop intent or creates a second writer.
- Report machine-readable status from the shared SQLite state and service-manager observation, not from file or log activity.
- Add isolated lifecycle, migration, duplicate-label, crash-recovery, permission, and rollback tests using fake managers and disposable state.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `oneprompt-convergence-supervisor`: consumes the shared fenced controller, adopts the actual service identity, and safely migrates the legacy supervisor state.

## Impact

- The only planned install.doctor implementation surface is the existing OnePrompt supervisor utility, its focused tests, and its documentation/evidence. It MUST remain path-isolated from the repository's unrelated dirty work.
- The completed `provision-oneprompt-convergence-supervisor` artifacts remain historical evidence. This linked change extends rather than rewrites or falsely re-completes them.
- Depends on a released immutable artifact from theme.tools change `extract-portable-convergence-control-plane` and a compatible OnePrompt CLI/worker revision.
- No UI is added or materially changed, so no Figma approval is required.
- This proposal does not mutate the live service, start convergence, deploy OnePrompt, publish a shared package, or claim fleet synchronization.
