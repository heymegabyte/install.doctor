# Contributing Guide

Thanks for considering contributing to Install Doctor! This guide covers everything you need to know to submit changes, fix bugs, or add new features.

## Code of Conduct

This project and everyone participating in it is governed by the [Code of Conduct](https://github.com/heymegabyte/install.doctor/blob/master/docs/CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [help@megabyte.space](mailto:help@megabyte.space).

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Install dependencies** by running the provisioning process on a test machine or VM
4. **Create a branch** for your changes
5. **Make your changes** and test them
6. **Submit a pull request** against the `master` branch

## Project Structure

Understanding the project layout is essential before making changes:

```
start.sh                          # Bootstrap script (installs Task, basic deps)
scripts/provision.sh              # Main orchestrator (Homebrew, deps, chezmoi)
home/                             # Chezmoi-managed dotfiles and configs
  .chezmoiscripts/universal/      # Cross-platform provisioning scripts
    run_before_*.sh.tmpl          # Pre-apply scripts (ordered by number)
    run_after_*.sh.tmpl           # Post-apply scripts (ordered by number)
  .chezmoiscripts/qubes/          # Qubes OS-specific scripts
  .chezmoidata.yaml               # Template variables and software groups
  dot_config/                     # ~/.config managed files
software.yml                      # Software definitions (12,000+ lines)
docs/                             # Project documentation
Taskfile.yml                       # Repository-owned task runner definitions
```

## Key Conventions

### Shell Scripts

- **Non-interactive by default** - All prompts must have 30-second timeouts or respect `HEADLESS_INSTALL=true`. Never add a prompt that can hang indefinitely.
- **Package manager flags** - Always include non-interactive flags: `--noconfirm` (pacman/makepkg), `-y` (apt/dnf/zypper), `echo |` piped to Homebrew install.
- **Use `$HOME` not `~`** - Tilde does not expand inside quotes. Always use `$HOME` in variable assignments.
- **Logging** - Use `logg info/warn/error` in `start.sh` and `provision.sh`. Use `gum log -sl info/warn/error` in chezmoi scripts (`run_before_*`, `run_after_*`).
- **Error handling** - Use `|| true` for commands that may legitimately fail (e.g., `pkill`, `rm`). Use `set -e` at the top of scripts.
- **POSIX compliance** - Prefer `[ $? -ne 0 ]` over `[ $? != 0 ]`. Use `command -v` instead of `which`.

### Chezmoi Templates

- Template files use `.tmpl` extension and Go template syntax
- Conditionals: `{{ if eq .chezmoi.os "darwin" }}...{{ end }}`
- Variables are defined in `home/.chezmoidata.yaml`
- Secrets are encrypted with Age and stored in `home/.chezmoitemplates/secrets/`

### Software Definitions (software.yml)

Each entry in `software.yml` maps a package name to its installation methods:

```yaml
package-name:
  _name: Human Readable Name
  _desc: Short description of the package
  _home: https://example.com
  brew: package-name          # Homebrew formula or cask
  apt: package-name           # APT package name
  dnf: package-name           # DNF/YUM package name
  pacman: package-name        # Pacman package name
  choco: package-name         # Chocolatey package name
  flatpak: org.example.App    # Flatpak app ID
  snap: package-name          # Snap package name
  cargo: package-name         # Cargo crate
  npm: package-name           # NPM package
  pip: package-name           # pip package
  github: owner/repo          # GitHub release binary
```

When adding software, fill in as many install methods as possible. At minimum, include `brew` and one Linux package manager.

## Testing Your Changes

### Local Testing

The safest way to test changes is in a virtual machine or container:

```bash
# Test on Ubuntu via Docker
docker run -it ubuntu:22.04 bash
apt update && apt install -y curl
curl -fsSL https://app.install.doctor/start | bash

# Test with headless mode
export HEADLESS_INSTALL=true
export SOFTWARE_GROUP=Minimal
curl -fsSL https://app.install.doctor/start | bash
```

### Re-Provisioning

Install Doctor is designed to be re-run safely. It detects already-installed software and skips it, so you can iterate quickly on changes.

## Pull Requests

### Guidelines

- **One concern per PR** - Keep pull requests focused on a single change
- **Describe the change** - Include what you changed and why in the PR description
- **Test on at least one platform** - Verify your changes work on at least macOS or one Linux distribution
- **Follow existing patterns** - Match the coding style of the surrounding code

### Commit Messages

Use clear, descriptive commit messages. We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add support for openSUSE Tumbleweed
fix: correct pacman flags for non-interactive install
docs: update FAQ with Apple Silicon instructions
```

## Common Contribution Areas

- **Adding software** - Add entries to `software.yml` with package names for each supported package manager
- **Fixing platform bugs** - Test on different distributions and fix platform-specific issues
- **Improving documentation** - Fix errors, add examples, or improve clarity
- **Adding integrations** - Add support for new cloud services or developer tools

## Questions?

If your question is not answered here, please [open an issue on GitHub](https://github.com/heymegabyte/install.doctor/issues) or visit our [Community page](https://install.doctor/community).
