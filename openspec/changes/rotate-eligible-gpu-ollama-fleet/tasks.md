# Tasks

## 1. Eligibility and reconciliation

- [x] 1.1 Add a failing-first 8 GiB VRAM eligibility contract and implement the default exclusion.
- [x] 1.2 Add an idempotent LiteLLM Ollama-node reconciler.
- [ ] 1.3 Install and verify Omen Ollama, authenticated ingress, shared model, and LiteLLM rotation.
- [ ] 1.4 Repair Zen's Coolify connection while confirming Ollama remains absent.

## 2. Integrated verification

- [ ] 2.1 Verify Legion and Omen GPU inference through LiteLLM and confirm all three KasmVNC desktops remain healthy.

- [x] Install and verify Omen's origin request and drain admission
  using the reusable Install Doctor proxy. The implementation was
  extracted from Legion's verified origin proxy with a user-owned
  default drain marker. The streaming fixture verifies slot lifetime,
  cancellation, the model allowlist, and bounded requests.

The disposable Omen canary passed authenticated readiness, drain and
recovery, and missing-token rejection against native Ollama. The
installed Omen proxy was replaced atomically while idle with SHA-256
`5ae6c307193686b60871612826b7c6a1b712f8cb45be4be71d1a1eb7b3d8695a`.
The existing user service and loopback port remained the entry point.
With its actual credential, readiness and new embedding requests
returned 503 during a bounded drain test. After marker removal the real
origin returned 768 embedding dimensions. Missing credentials received
401. The old script is saved as
`~/.local/bin/ollama-auth-proxy.ts.pre-admission-20261128`.
Coolify ingress and distributed admission remain open.
