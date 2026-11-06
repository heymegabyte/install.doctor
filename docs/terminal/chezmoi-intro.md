# Install Doctor: Multi-OS provisioning made easy

Install Doctor transforms a fresh OS into a fully-configured development workstation with a single command. It manages 1,000+ software packages, shell configurations, cloud integrations, and encrypted secrets across macOS, Linux, and Windows.

Check out [the documentation](https://install.doctor/docs) for the complete guide on forking, customizing, and deploying your own configuration.

## Quick Start

```shell
curl -fsSL https://app.install.doctor/start | bash
```

## Customizing

| Step | Action | Details |
|---|---|---|
| 1 | **Fork the repo** | [Fork on GitHub](https://github.com/heymegabyte/install.doctor/fork) |
| 2 | **Generate an Age key** | `age-keygen -o key.txt` (see [Secrets docs](https://install.doctor/docs/customization/secrets)) |
| 3 | **Encrypt your secrets** | Populate `home/.chezmoitemplates/secrets/` with encrypted API keys and tokens |
| 4 | **Customize settings** | Edit `home/.chezmoidata.yaml` (software groups) and `home/.chezmoi.yaml.tmpl` (user identity) |
| 5 | **Add/remove software** | Edit `software.yml` to add packages or modify install methods per platform |
| 6 | **Push to your fork** | Commit and push all changes to your GitHub fork |

## Headless Deploy

With your fork configured, provision any machine headlessly:

```shell
export AGE_PASSWORD=YourAgePassword
export START_REPO=YourGitHubUsername
export SUDO_PASSWORD=YourSudoPassword
export SOFTWARE_GROUP=Standard
export HEADLESS_INSTALL=true
curl -fsSL https://app.install.doctor/start | bash
```

## Key Files

| File | Purpose |
|---|---|
| `software.yml` | Software definitions: package names per package manager (12,000+ lines) |
| `home/.chezmoidata.yaml` | Template variables, software groups, user preferences |
| `home/.chezmoi.yaml.tmpl` | Chezmoi configuration: user identity, encryption settings |
| `home/.chezmoitemplates/secrets/` | Age-encrypted secrets (API keys, tokens) |
| `home/dot_config/shell/` | Shell configuration (aliases, exports, functions) |
| `home/.chezmoiscripts/universal/` | Provisioning scripts (before/after Chezmoi apply) |
