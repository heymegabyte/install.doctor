## ADDED Requirements

### Requirement: Typed OpenAPI fixture coverage

The bundled HTTP suite SHALL validate the OpenAPI path map before checking route coverage.

#### Scenario: A Worker route is discovered

- **WHEN** a route is found in the Worker source
- **THEN** the test asserts its path and method are documented in the served specification
