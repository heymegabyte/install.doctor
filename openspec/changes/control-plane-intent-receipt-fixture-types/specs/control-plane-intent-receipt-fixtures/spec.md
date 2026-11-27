## ADDED Requirements

### Requirement: Intent and receipt fixtures validate consumed fields

The bundled HTTP fixtures SHALL validate fields before using them in assertions or follow-up requests.

#### Scenario: The receipt test passes a response back to the verifier

- **WHEN** the test receives a minted receipt
- **THEN** it checks the hash field and submits the complete response to the existing verifier
