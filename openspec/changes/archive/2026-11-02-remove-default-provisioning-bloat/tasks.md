# Tasks

## 1. Default Selection Policy

- [x] 1.1 Add `_default: false` to the 30 approved catalog entries and verify the focused policy test finds exactly the approved set
- [x] 1.2 Enforce `_default: false` for automatic `--all` selection while preserving named installation, and verify selector assertions pass
- [x] 1.3 Add and wire the default-provisioning-policy regression test, then verify it passes with the existing software YAML validation
- [x] 1.4 Document opt-in default exclusions in the fleet provisioning context and verify documentation names the marker and non-destructive behavior

## 2. Integration Verification

- [x] 2.1 Run strict OpenSpec validation plus focused provisioning tests and confirm all checks pass

## Workflow follow-up

- Sync the completed delta spec and archive the change after verification.
