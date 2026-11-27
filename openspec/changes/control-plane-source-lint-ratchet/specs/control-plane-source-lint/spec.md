## ADDED Requirements

### Requirement: Strict typed lint for clean Control Plane source modules
Control Plane verification SHALL apply the shared strict typed profile to production TypeScript files. Existing source diagnostics MAY have exact-path exceptions that are recorded and removed as files pass the strict gate.

#### Scenario: Add a new production source module
- **WHEN** package or GitHub Linux verification runs
- **THEN** the strict source project checks the new file without a manual config entry
