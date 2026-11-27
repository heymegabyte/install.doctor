## ADDED Requirements

### Requirement: Strict typed publication tests

The offline bundle and bootstrap release publication fixtures SHALL pass the shared strict typed lint profile and SHALL retain their existing publication and activation assertions.

#### Scenario: Publication assertions run with local storage

- **WHEN** the publication tests run against the in-memory storage adapter
- **THEN** storage conflicts, authority checks, and verified activation are exercised without external operations
