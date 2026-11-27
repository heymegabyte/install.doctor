## ADDED Requirements

### Requirement: Bundled test fixture validates the request handler

The bundled Worker test fixture SHALL verify its dynamically loaded fetch handler and validate each returned Response.

#### Scenario: The existing HTTP tests load the bundled Worker

- **WHEN** a fixture caller passes a request and environment
- **THEN** the wrapper invokes the real bundled handler with the original receiver and returns its Response
