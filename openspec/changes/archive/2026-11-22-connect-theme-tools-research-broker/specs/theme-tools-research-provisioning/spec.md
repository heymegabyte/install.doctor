# theme-tools-research-provisioning Delta

## ADDED Requirements

### Requirement: Value-free broker access binding

install.doctor SHALL declare an HTTPS theme.tools research endpoint and SHALL bind its service credential through the fixed `THEME_RESEARCH_SERVICE_TOKEN` Infisical reference without storing or resolving the credential value.

#### Scenario: Complete broker binding

- **WHEN** the desired-state manifest declares the HTTPS endpoint and matching fixed-leaf service-token reference
- **THEN** the dry-run plan emits deterministic non-mutating configuration and secret-reference actions

#### Scenario: Missing or unsafe broker binding

- **WHEN** the endpoint is not HTTPS, contains credentials, or the fixed service-token reference is absent
- **THEN** validation fails before any provider operation

