## ADDED Requirements

### Requirement: Validate the public Worker fixture shape
The shared Cloudflare Worker test fixture SHALL check its dynamically imported fetch handler and SQLite adapter before exposing them to test callers.

#### Scenario: Load the test bundle and invoke the handler
- **WHEN** a test creates a Worker fixture and calls fetch
- **THEN** the fixture verifies the handler, the required adapter methods, and the resulting Response
