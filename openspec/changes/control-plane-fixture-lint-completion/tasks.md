# Tasks

- [x] Integrate the remaining verified fixture changes and remove the exemption list.
- [x] Confirm checked paths match the tracked fixture inventory and run the full package suite.
- [x] Confirm the GitHub Linux structural lint step.

The normal strict lint profile returned exactly the 38 tracked test and helper paths with zero findings and no exceptions. All 171 package tests passed on Node 24.22.2, including the Worker dry run.

GitHub Linux passed the Control Plane lint step at `491c7e59` in run `45939396033`. A temporary new helper triggered the expected floating promise finding and was removed.
