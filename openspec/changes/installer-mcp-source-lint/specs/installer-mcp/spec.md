## ADDED Requirements

### Requirement: Typed MCP stdio ingress

The Installer Engine MCP stdio entry point SHALL narrow untrusted JSON-RPC request fields before dispatch and pass the shared strict Installer Engine source lint profile.

#### Scenario: Malformed request
- **WHEN** a client submits malformed JSON or an invalid JSON-RPC envelope
- **THEN** the runtime emits the corresponding parse or invalid-request error with a scalar or null correlation ID.
