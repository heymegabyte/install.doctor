# Installer Engine resilience policy

## ADDED Requirements

### Requirement: Resilience policy sources pass strict typed lint

The reboot, UPS, ZFS, Syncoid, and workload backup policy modules SHALL pass the shared strict typed lint profile while preserving their existing output and validation contracts.

#### Scenario: Evaluate maintenance and data protection policy

- **WHEN** Installer Engine validates persisted maintenance state or evaluates a shutdown, recovery, replication, or backup plan
- **THEN** digest identities, graph ordering, admission decisions, and schedule collision findings follow the established contracts.
