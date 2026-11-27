# Tasks

- [x] Verify and update outer Node test registration statements.
- [x] Compare strict lint diagnostics and verify the Control Plane suite.

The edit added only 170 void operators across 35 test files. The audited 38 test and fixture files went from 1,687 strict findings to 1,517, with zero floating-promise findings. All 171 package tests and the Worker build dry run passed on Node 24.22.2.
