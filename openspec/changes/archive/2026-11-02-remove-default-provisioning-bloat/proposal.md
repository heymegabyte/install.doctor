# Proposal

## Why

The default graphical workstation provision currently considers hundreds of applications and background services because `installx --all --lazy` treats every app, preload, and enabled service as default-eligible. This installs redundant, retired, specialist, and network-listening software without an explicit role or user choice.

## What Changes

- **BREAKING**: Exclude 30 identified packages from automatic `--all --lazy` provisioning.
- Preserve explicit named installation for catalog entries that remain useful to server, privacy, virtualization, compatibility-testing, or specialist workflows.
- Remove unequivocally obsolete or superseded entries where retaining them would be misleading.
- Add a regression test that locks the exclusion list and verifies explicit installation remains possible.
- Document the default-selection policy and the affected catalog entries.

## Capabilities

### New Capabilities

- `default-provisioning-policy`: Defines which catalog entries may be selected automatically and how opt-in software remains explicitly installable.

### Modified Capabilities

None.

## Impact

Affected surfaces are `software.yml`, the `installx` selection pipeline, provisioning regression tests, and fleet provisioning documentation. Existing installations are preserved; this change prevents future default selection and does not uninstall software from already-provisioned hosts.
