# Tasks

- [x] Resolve strict lint findings in the two composition suites.
- [x] Verify strict lint, Control Plane test types, and both runtime suites with Node 24.22.2.

Node 24.22.2 ran both suites in separate processes. All five tests passed. The isolated change also passed the full Control Plane test type check, the unignored strict lint profile, and the Worker build dry run.
