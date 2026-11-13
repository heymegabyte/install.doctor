# Tasks

## 1. Specify and reproduce

- [x] 1.1 Record the live launchd observation showing a loaded timer-driven definition reported as inactive after a bounded no-progress exit.
- [x] 1.2 Add failing disposable launchd and systemd assertions for scheduled waiting versus missing manager admission.

## 2. Implement canonical host observation

- [x] 2.1 Separate active-process observation from loaded/enabled schedule observation in the portable adapter.
- [x] 2.2 Classify scheduled waiting as healthy only under compatible artifact, running intent, no-owner, waiting-worker invariants.

## 3. Verify and install

- [x] 3.1 Run strict OpenSpec validation, shell syntax checks, and the focused supervisor lifecycle suite.
- [x] 3.2 Commit and publish the install.doctor slice, install the exact adapter, and verify scheduled and active live receipts without changing the fifteen-minute cadence.
