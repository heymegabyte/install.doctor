## ADDED Requirements

### Requirement: Validate HTTP fixture read models

The test suite SHALL validate consumed fields of identity, catalog, migration, product status, and pairing responses.

#### Scenario: A test inspects a response

- **WHEN** a fixture uses fields from a response body
- **THEN** it validates those fields and preserves any extra fields for existing assertions
