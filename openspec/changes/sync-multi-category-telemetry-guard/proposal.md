# Proposal: Fail-Open 2500ms Langfuse Telemetry & Multi-Category Readiness Guard

## Why
Synchronized from the `bricklabor.com` Triad Sync: ensure all Worker AI / LLM invocations enforce a strict `2500ms` Langfuse ingestion timeout (`AbortSignal.timeout(2500)`) with a 3-strike circuit breaker (`60s` cooldown) so telemetry outages never block control-plane or user-facing execution.

## What Changes
- Adopt the `traceAiGeneration` 2500ms fail-open circuit breaker contract across control-plane Worker AI helpers.
