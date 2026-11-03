# Design

## Bootstrap and TUI

`app.install.doctor/start` returns POSIX shell that creates a private temporary directory, downloads a release-pinned provisioner, optionally verifies a supplied SHA-256 digest, and then executes the local file. Interactive runs reconnect stdin to `/dev/tty`; headless runs use `/dev/null`. The launcher traps cleanup and never uses process substitution.

The provisioner remains Bash and progressively enhances with Gum. It produces a durable JSON plan before mutation. Plain ANSI/no-color and headless paths remain first-class. Native Windows uses PowerShell; the Bash URL supports macOS, Linux, FreeBSD, Qubes, and Windows through WSL/Git Bash.

## Selection policy

Stable catalog policy is separate from volatile popularity evidence. `_default: false` remains the compatibility field. A generated audit reports stars, maintenance, AI/web capabilities, and cohort-relative scores; stars are a tie-breaker rather than a global install mandate. Services and public listeners never become defaults only because they are popular.

## Parallelism

Install tasks are lazy thunks consumed by a bounded queue. Native package-manager transactions and privileged/network mutations are serialized. Discovery, downloads, checksums, independent user-space installers, and verification may run concurrently. Failures are aggregated and make the installer exit non-zero.

## Migrations

Tailscale is removed from future selection and configuration. Existing running instances are detected and reported for a consented migration; they are not uninstalled. Cloudflare Tunnel/WARP, SSH, and explicit firewall policy are the supported enrollment choices.

uv becomes the default Python tool. Poetry remains opt-in for projects that require `poetry.lock` compatibility.

## Agent-provider boundary

Repository work follows the canonical OpenCode → LiteLLM → rotating DeepSeek/local Ollama throughput policy. This is distinct from aid's documented product runtime decision to use ProjectSites routing without LiteLLM.
