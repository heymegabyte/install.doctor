# GPU Ollama fleet

## ADDED Requirements

### Requirement: Capability-gated GPU enrollment
Install Doctor SHALL enroll Linux NVIDIA Ollama nodes only when the first GPU has at least 8 GiB VRAM, unless an operator explicitly overrides the guard.

#### Scenario: Zen low-VRAM GPU
- **WHEN** a host reports a 2 GiB NVIDIA GPU
- **THEN** Ollama installation and LiteLLM enrollment are skipped

### Requirement: Desktop-safe inference
Ollama SHALL remain independent of the live GNOME/KasmVNC chain and SHALL not replace or stop its display services.

#### Scenario: Inference while remotely connected
- **WHEN** Ollama serves a request on Legion or Omen
- **THEN** the live KasmVNC desktop remains reachable and returns a non-blank framebuffer

### Requirement: Authenticated rotation
LiteLLM SHALL rotate common model aliases across eligible Ollama nodes using authenticated origins, health-aware retries, and no duplicate deployment entries.

#### Scenario: Omen enrollment
- **WHEN** Omen exposes the approved model through its authenticated Cloudflare origin
- **THEN** each governed local alias contains one Legion deployment and one Omen deployment
