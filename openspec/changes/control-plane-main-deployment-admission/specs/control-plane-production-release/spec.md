## ADDED Requirements

### Requirement: Review exact main revisions for Control Plane release
The approved Control Plane production release workflow SHALL use reviewed exact main revisions and retain the protected environment and separate migration and deployment identities.

#### Scenario: Dispatch an approved main revision
- **WHEN** an authorized reviewer approves a production deployment dispatched for a main revision
- **THEN** migration and deployment use the approved workflow revision and record its exact source SHA in release evidence
