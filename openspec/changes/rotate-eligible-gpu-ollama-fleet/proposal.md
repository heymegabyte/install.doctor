# Rotate eligible GPU Ollama fleet

> **Architect:** codex
> **Architect Role:** assigned

## Why

Legion and Omen have GPUs capable of serving the shared 7B Ollama model while retaining their live GNOME/KasmVNC desktops. Zen's 2 GiB GPU is below the safe inference floor and must not be enrolled.

## What changes

- Require at least 8 GiB NVIDIA VRAM for automatic Linux Ollama enrollment.
- Keep Ollama loopback-only behind an authenticated Cloudflare tunnel origin.
- Add Omen alongside Legion in existing LiteLLM aliases using simple-shuffle routing.
- Preserve KasmVNC and reserve desktop rendering independently from Ollama inference.
- Keep Zen connected to Coolify while explicitly excluding it from Ollama.
