# Megabyte Labs Ecosystem

This project incorporates design patterns from the [Megabyte Labs](https://megabyte.space) ecosystem. The ecosystem is a set of repositories that integrate with one another through CI/CD. The repositories share configurations, common documentation partials, and developer tools.

## Goals

1. Keep projects up-to-date with the latest best practices
2. Make the management of large amounts of repositories easy
3. Implement development features proactively (within reason)
4. Maximize developer efficiency
5. Improve developer onboarding by providing tools that enforce design patterns with minimal oversight
6. Serve as an example of a bleeding-edge, production-ready full-stack development platform

## How Install Doctor Fits In

Install Doctor is the cornerstone of the Megabyte Labs ecosystem. It provisions developer workstations with all the tools, configurations, and integrations needed to work effectively across the entire ecosystem:

| Category | What Install Doctor Configures | Example Tools |
|---|---|---|
| **Development tools** | Language runtimes, compilers, linters, formatters | Node.js, Go, Python, Rust, ShellCheck, ESLint |
| **Shell environment** | Bash and ZSH with frameworks, aliases, functions | Oh-My-ZSH, Powerlevel10k, Bash-It, zoxide, fzf |
| **Security tooling** | Antivirus, intrusion detection, VPN, encryption | ClamAV, fail2ban, Cloudflare WARP, Age |
| **Infrastructure tools** | Containers, VMs, orchestration, IaC | Docker, Vagrant, Terraform, Ansible, kubectl |
| **CI/CD integration** | Source control, CI runners, automation | GitHub CLI, GitLab CLI, Task runner |
| **Editor setup** | IDE configuration, extensions, themes | VS Code, Neovim (NvChad), VIM |

## Shared Components

The ecosystem uses several shared components:

- **Taskfile** - All projects use [Task](https://taskfile.dev/) as the build system with shared Taskfile definitions
- **Common configurations** - Linter configs, editor settings, and CI/CD pipelines are synchronized across repos
- **Documentation** - Shared documentation partials and templates ensure consistent documentation
- **Logging** - The `logg` / `gum log` logging functions provide consistent output formatting

## Language Support

Projects in the ecosystem are built with:

- **Shell (Bash/ZSH)** - Provisioning scripts, shell configurations, and system automation
- **TypeScript** - CLI tools, web applications, and the ZX-based software installer
- **Python** - Ansible playbooks and automation scripts
- **Go** - CLI utilities and system tools
