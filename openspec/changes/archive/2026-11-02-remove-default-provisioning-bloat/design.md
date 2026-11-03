# Design

## Context

`installx --all --lazy` first maps every compatible catalog entry, then retains graphical apps, preloads, and enabled services. The existing `_deprecated` marker suppresses all installation, including explicit requests, so it cannot represent supported-but-opt-in software. Existing fleet guidance requires server, VNC, privacy, and virtualization paths to remain available.

## Goals / Non-Goals

**Goals:**

- Introduce one catalog-level marker for entries excluded only from automatic selection.
- Apply it before lazy/headless eligibility so apps and enabled services behave consistently.
- Preserve explicit named installation and existing installed software.
- Lock the exact approved set with a fast regression test.

**Non-Goals:**

- Uninstall software already present on a host.
- Delete server, privacy, virtualization, or compatibility capabilities from the catalog.
- Complete the broader role/tier system described in project documentation.

## Decisions

1. Add `_default: false` to each of the 30 catalog entries. This is clearer and more extensible than a hard-coded JavaScript denylist, and unlike `_deprecated`, it preserves explicit installation.
2. Enforce the marker only when `--all` is active. Named installation remains subject to existing OS, binary-presence, `_when`, `_deprecated`, and lazy filters.
3. Keep all 30 definitions for now. Even retired clients may be needed to cleanly identify legacy state, while deleting entries would prevent explicit or migration-oriented use. Their default exclusion removes the immediate risk.
4. Add a dedicated shell regression test and wire it into the repository test task. The test validates both metadata and selector semantics without performing package installation.

## Risks / Trade-offs

- [A caller combines `--all` with named keys and expects names to override] → Define `--all` as automatic policy; explicit override requires omitting `--all`.
- [Static regression test misses runtime parser drift] → Run existing software YAML validation and provisioning hygiene tests alongside the focused policy test.
- [Existing machines retain removed software] → This change is intentionally non-destructive; removal from live hosts requires a separate observed-state migration with consent.

## Migration Plan

1. Add and enforce the catalog marker.
2. Run YAML, focused policy, and provisioning test suites.
3. Update provisioning documentation to describe the opt-in behavior.
4. Roll back by reverting the selector filter and metadata; no host state migration is required.
