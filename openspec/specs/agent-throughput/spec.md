# Agent throughput Specification

## Purpose

Defines capability-first model routing that preserves premium judgment while offloading suitable throughput work.

## Requirements

### Requirement: Capability-first offload

Premium agent instructions SHALL point to the canonical provider policy and delegate eligible throughput work to OpenCode through LiteLLM with DeepSeek/local Ollama. Independent eligible tasks SHOULD use the swarm runner. Premium models retain decomposition, high-risk judgment, integration, and verification.

#### Scenario: aid runtime work

- **WHEN** implementing the aid product runtime
- **THEN** the separate ProjectSites routing decision remains authoritative and is not conflated with internal development offload
