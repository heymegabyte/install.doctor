# Spec Delta

## MODIFIED Requirements

### Requirement: Capability-first offload

Premium agent instructions SHALL point to the canonical provider policy and delegate eligible throughput work to OpenCode through LiteLLM with DeepSeek or local Ollama. Independent eligible tasks SHOULD use a bounded attributable swarm when collision and shared-state analysis permits it. Each child SHALL receive a task-scoped sandbox, explicit budget, minimal tools and secrets, immutable context binding, and authority no broader than its parent task. Premium models retain decomposition, architecture, high-risk judgment, sensitive shared-state decisions, integration, and final verification.

#### Scenario: aid runtime work

- **WHEN** implementing the Desktop Tools product runtime
- **THEN** the separate ProjectSites routing decision remains authoritative and is not conflated with internal development offload

#### Scenario: Safe independent fan-out

- **WHEN** several implementation or verification units have disjoint write domains and explicit acceptance criteria
- **THEN** the orchestrator may execute them concurrently with distinct identities and merge only independently verified results

#### Scenario: Shared mutation authority

- **WHEN** candidate tasks affect the same architecture artifact, secret policy, pool, dataset, release authority, or repository lines
- **THEN** the orchestrator serializes them or assigns one owner instead of creating competing writers

#### Scenario: Child attempts authority expansion

- **WHEN** a delegated agent requests an undeclared tool, secret, path, model budget, subagent, or external action
- **THEN** enforcement denies it and the parent cannot accept the result as verified completion
