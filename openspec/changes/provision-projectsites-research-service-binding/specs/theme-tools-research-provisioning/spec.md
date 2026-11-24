# Theme.tools research provisioning delta

## ADDED Requirements

### Requirement: ProjectSites research consumer binding
install.doctor SHALL declare a value-free ProjectSites `RESEARCH` service binding to the canonical same-environment research Worker with server-controlled authority enrollment and exact organization/actor scope headers.

#### Scenario: ProjectSites staging plan
- **WHEN** the staging desired state is validated and planned
- **THEN** it emits deterministic binding and authority-validation actions containing no endpoint credential or provider secret
