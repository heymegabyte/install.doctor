---
title: Customizing Software Definitions
description: Read the technical details on how to customize the software that Install Doctor provisions and configures on your devices.
sidebar_label: Software
slug: /customization/software
---

Install Doctor makes it easy to customize what software is installed on your devices. Although we provide some great templates that install packages we recommend, you may want to customize the installation process to only install packages that are relevant to the technologies you want to focus on. You can customize the packages that are provisioned by forking Install Doctor and then editing YAML files where the lists of software you want to install are housed.

## Customizing

The basics of customizing the software you want to install on your device with your fork are outlined on the [Customization](/docs/customization) page. There, you can find details on how to define a list of software packages you want to install. You can customize the software installed by editing our templates or even defining hostname-specific lists.

## Plugins

Several programs that many developers and power-users use include Google Chrome, Mozilla, and Visual Studio Code. Install Doctor supports pre-installing and configuring addons for these applications and more by defining lists of plugins to install, similar to how you define the list of software packages you would like to install on your device.

In many cases, depending on how you install a program that leverages plugins, the location that the plugins install to will change. The scripts that install the plugins include logic that will loop through the various known locations and install the plugins if the location is present on the system. You can see an example of this in the [script that provisions Firefox addons](https://github.com/heymegabyte/install.doctor/blob/master/home/.chezmoiscripts/universal/run_onchange_after_40-firefox.tmpl), for instance.

### Google Chrome / Brave

You can pre-install Google Chrome and Brave extensions by defining a list of them in the `home/.chezmoidata.yaml` file. Simply specify the list of extensions you would like provisioned by using either of the following formats in the following example `.chezmoidata.yaml` file:

```yaml
chromeExtensions:
  - https://chrome.google.com/webstore/detail/automa/infppggnoaenmfagbfknfkancpbljcca
  - google-translate/aapbdbdomjkkjkaonfhkkikfgjllcleb
```

### Firefox

Similarly, you can pre-install Firefox addons by customizing the following variable in `chezmoidata.yaml`:

```yaml
firefoxAddOns:
  - automa
  - bitwarden-password-manager
```

### Visual Studio Code

Visual Studio Code plugins are stored outside of the `.chezmoidata.yaml` file, in the user configuration location. This is because Visual Studio Code can digest plugins stored in its own format. It will automatically recommend that the user install plugins that are missing from the list. The list is stored in `home/dot_config/Code/User/extensions.json`. If you modify this file to only include the Prettier plugin and the EditorConfig plugin, then the contents of this file would be:

```json
{
  "recommendations": [
    "EditorConfig.EditorConfig",
    "esbenp.prettier-vscode"
  ]
}
```

You can also edit the other files in the `home/dot_config/Code/User/` folder to include your preferred default settings for the plugins you install. If you come up with an improvement, we encourage you to [submit a pull request](/docs/contributing/pull-requests) so that we can continually improve the default settings.

### VIM

VIM and Neovim plugins are declared in `home/.chezmoidata.yaml` under `vimPlugins`. Each entry pins an upstream repository, an immutable commit, and the SHA-256 and byte size of its archive:

```yaml
vimPlugins:
  - { name: vim-surround, repo: tpope/vim-surround, commit: 3d188ed2113431cf8dac77be61b842acb64433d9, sha256: 95f18606..., size: 10236 }
```

`chezmoi apply` unpacks every pinned archive twice, once per editor:

- Vim — `~/.local/share/vim/plugged/<name>`, loaded by the guarded `vim-plug` block in `home/dot_config/vim/vimrc`
- Neovim — `~/.local/share/nvim/site/pack/install-doctor/start/<name>`, auto-loaded by Neovim's native `pack/*/start` mechanism

Both editors therefore start with their plugins already present. Nothing is fetched, cloned, or `:PlugInstall`-ed when you open the editor, so no second pane appears and a first launch on a slow network still works offline. Adding a plugin means adding one `vimPlugins` entry; both editors receive it, and `scripts/test-nvim-plugins.sh` plus `scripts/test-external-integrity.sh` enforce parity and archive integrity in CI. Windows hosts use the Neovim data directory that Neovim reports itself, so the `pack/` copy is not applied there.

## Defining Packages

After reading our [Customization](/customization) documentation, you will begin to realize how easy it is to define software package installations across many different operating systems. This can be done with very little code by editing the YAML definitions either in the `software.yml` file (if you decide to open a pull request so that the definitions can be made available to everyone) or in the `software-custom.yml` file that can contain definitions that you do not wish to contribute.

Definitions may select package-manager coordinates per operating system. Catalog YAML is data, not a shell program: legacy `script*`, `_when*`, `_pre*`, and `_post*` fields are rejected or inert while they are migrated. Reviewed typed hooks own any necessary post-install configuration.

<iframe width="100%" height="430" src="https://www.youtube-nocookie.com/embed/UHpoYumybeY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

### Package Managers

Each package definition can (and should) contain definitions for every type of install method. The following example includes a definition that, in theory, can be installed by every type of package manager.

```yaml
---
softwarePackages:
  altair:
    apk: altair
    appimage: https://developers.yubico.com/yubikey-manager-qt/Releases/yubikey-manager-qt-1.2.4b-linux.AppImage
    basher: xwmx/nb
    binary:darwin: https://dl.min.io/client/mc/release/darwin/mc
    binary:linux: https://dl.min.io/client/mc/release/linux-amd64/mc
    binary:windows: https://dl.min.io/client/mc/release/windows-amd64/mc.exe
    bpkg: xwmx/nb
    brew: altair
    cargo: tree-sitter-cli
    cask: altair-graphql-client
    crew: altair
    choco: altair-graphql
    dnf: altair
    flatpak: com.yubico.yubioath
    gem: altair
    go: github.com/ProfessorManhattan/blockinfile@latest
    krew:
      - ctx
      - ns
    npm: altair
    pacman: altair
    pipx: altair
    pkg-freebsd: altair
    pkg-termux: altair
    port: altair
    scoop: altair
    snap: altair
    whalebrew:
    winget: Neovim.Neovim
    xbps: altair
    yay: altair
    zypper: altair
```

Package definitions are package coordinates or arrays of coordinates. Executable code is not a supported catalog value. You can find out more about each package manager below:

| Package Manager | Description |
| --------------- | ----------- |
| `apk` | Linux Alpine system package manager |
| `appimage` | AppImages installed by [Zap](https://github.com/srevinsaju/zap) |
| `basher` | Packages installed by [Basher](https://github.com/basherpm/basher) |
| `binary` | Direct URL to package binary |

#### AppImages

Browsing through the `software.yml` file, you might notice `appimage` definitions defined several different ways. [Zap](https://github.com/srevinsaju/zap) is used to install AppImages so you can install AppImages any way that Zap supports. This includes direct links to the AppImage file as well as simple names if the AppImage is in the [AppImage catalog](https://g.srev.in/get-appimage/) that Zap supports.

#### Typed configuration hooks

Do not define shell scripts in YAML. Add a reviewed `post-installx/post-<package>.sh` hook only when package-manager installation is insufficient; its execution must remain selected and bounded by the provisioning graph.

Hooks resolve by file name (`post-<software.yml key>.sh`) and self-gate: each one no-ops unless its tool is present, its platform applies, and its explicit opt-in is set. Optional integrations such as `gitlab-runner` stay inert until you enable them.

**GitLab Runner enrollment (`post-gitlab-runner.sh`)**

Mirrors the GitHub runner behaviour: no pre-minted registration token is stored anywhere. The hook asks the GitLab API for a fresh runner authentication token and registers it non-interactively.

```shell
export INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1
export GITLAB_ACCESS_TOKEN="$(get-secret GITLAB_ACCESS_TOKEN)"  # create_runner scope (+ api for group/project)
export GITLAB_RUNNER_SCOPE=group
export GITLAB_RUNNER_GROUP_ID=12345
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL` | `0` | Opt-in gate. Enrollment never runs unprompted. |
| `GITLAB_ACCESS_TOKEN` | — | Access token with `create_runner`; resolves from env, `get-secret`, or the age-encrypted chezmoi secret. |
| `GITLAB_URL` | `https://gitlab.com/` | Target GitLab instance. |
| `GITLAB_RUNNER_SCOPE` | `group` | `instance`, `group`, or `project`. |
| `GITLAB_RUNNER_GROUP_ID` | — | Required for `group` scope. |
| `GITLAB_RUNNER_PROJECT_ID` | — | Required for `project` scope. |
| `GITLAB_RUNNER_NAME` | `<hostname>-gitlab-runner` | Runner description; a name already registered in the config is left untouched (idempotent). |
| `GITLAB_RUNNER_EXECUTOR` | `docker` | `docker`, `shell`, `virtualbox`, or `kubernetes`. |
| `GITLAB_RUNNER_IMAGE` | `alpine:latest` | Docker executor image. |
| `GITLAB_RUNNER_BASE_VM` | — | Required for the `virtualbox` executor. |
| `GITLAB_RUNNER_TAGS` | — | Comma-separated runner tags. |
| `GITLAB_RUNNER_CONFIG` | `~/.config/gitlab-runner/config.toml` | Runner config path (written `0600`). |

The access token reaches `curl` through a `0600` header file, so it never appears in `argv` or the process list, and the minted runner token is never written to stdout or provisioning logs. `scripts/test-gitlab-runner-post-hook.sh` locks the contract offline (11 assertions, stubbed `curl` and `gitlab-runner`, no network).

#### Package Manager Preference

The preference of which package manager to use during the installation process is defined by the `installerPreference` `software.yml` variable. There are more details on this on the [Customization](/docs/customization) page.

#### Package Manager Installation

If the preferred package manager determined by the `installerPreference` variable is not available on the system, then the installer will install the package manager prior to using it to install the package. The installation method can be determined by inspecting the [source of the ZX-based installer](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_local/bin/executable_install-program).
