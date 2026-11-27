# Design

**Architect Role:** assigned

Mark top-level Node test registrations as runner-owned promises. Preserve asynchronous mock dependencies with explicit promise results and construct fixtures with intentionally omitted fields without unused bindings. Verify the three files through the Control Plane test TypeScript project with the existing shared strict lint profile. The change is limited to fixture code and does not add a runtime dependency.
