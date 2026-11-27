## ADDED Requirements

### Requirement: Bounded authorization response lifetime

The target device authorization transport SHALL keep the configured deadline and caller abort signal active while reading an authorization response.

#### Scenario: Poll receives a partial response

- **WHEN** a poll receives response headers and a JSON chunk but the stream stalls
- **THEN** a transport timeout or caller abort terminates response reading.
