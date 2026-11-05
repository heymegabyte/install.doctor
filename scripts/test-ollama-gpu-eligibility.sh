#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-ollama.sh"

bash -n "$HOOK"
grep -q 'OLLAMA_MIN_GPU_VRAM_MIB:-8192' "$HOOK"
grep -q 'memory.total' "$HOOK"
grep -q 'OLLAMA_ALLOW_LOW_VRAM_GPU:-0' "$HOOK"
grep -q 'GPU VRAM' "$HOOK"
printf 'ollama-gpu-eligibility: pass\n'
