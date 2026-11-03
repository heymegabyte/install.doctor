---
title: Customization
description: Discover how to customize Install Doctor to better serve your own multi-OS provisioning needs. Learn about how Install Doctor incorporates Chezmoi, terminal prompts, YAML definitions, and advanced automation techniques.
sidebar_label: Overview
slug: /customization
---

There are many ways you can customize Install Doctor so that your device is provisioned to your liking. There are even ways to customize it without creating your own fork. You can customize it by utilizing the built-in prompt system, using environment variables, or forking it so that you can leverage encrypted secrets, custom software definitions, and custom scripts.

## Chezmoi

The Install Doctor project leverages dozens of technologies but, at its core, it is ultimately a Chezmoi project. This allows us to leverage Chezmoi's script execution abilities, encryption handlers, and diff feature (which allows you to display the changes that will be made before applying them).

If you decide that our built-in prompt system does not accommodate your needs, we highly recommend you sift through [Chezmoi's documentation](https://www.chezmoi.io/). By reading the documentation, you will learn why some files and folders start with `dot_`, how files ending with `.tmpl` are rendered, and additional features you can leverage.

That said, if you do not feel like taking a deep dive and learning a new technology, then you can leverage our built-in prompt system. Better yet, if you want to customize Install Doctor, you can customize the repository to your liking without having to learn the inner workings and features of Chezmoi.

Our project is the most elaborate and full-featured implementation of Chezmoi we have come across. If you come across another project that parallels the full-featuredness of ours then please let our team and community know about it by posting in one of our social media sites / chat rooms which are all linked to on the [Community page](https://install.doctor/community).

## Prompts

If you run Install Doctor for the first time, you might want to just run `bash <(curl -sSL https://install.doctor/start)` on Linux / macOS or `iex ((New-Object System.Net.WebClient).DownloadString('https://install.doctor/windows'))` on Windows. This will utilize Install Doctor's default settings along with prompts that gather some basic information about the type of installation you would like to perform.

One of the first things you will be prompted for is to select the type of software install you want to perform. You can choose one of the following:

1. **Basic** - Includes software and utilities that are required for an enhanced terminal session as well as some software that we consider vital and important enough to install on any machine.
2. **Standard** - Includes all the software installed by the *Basic* setting as well as other *stable* CLIs and applications that will most likely be useful to the standard user.
3. **Full** - A full installation installs the majority of the software that we have tested and included in the software definitions file. It includes all the software installed by selecting *Basic* or *Standard*.

The built-in prompts will ask for a small handful of other important pieces of data:

| Prompt | Environment Variable | Description |
|---|---|---|
| Sudo password | `SUDO_PASSWORD` | For installing Homebrew and system packages |
| Full name | `FULL_NAME` | Populates git config and other identity files |
| Email address | `PRIMARY_EMAIL` | Populates git config and GPG identity |
| Software group | `SOFTWARE_GROUP` | `Minimal`, `Standard`, or `Full` |
| Corporate environment | `CORPORATE_ENVIRONMENT` | Set `true` to skip software that might violate corporate policies (e.g., Tor) |
| Restricted environment | `RESTRICTED_ENVIRONMENT` | Set `true` for environments without sudo access (experimental) |
| Domain name | `PUBLIC_SERVICES_DOMAIN` | Used for CloudFlare tunnel endpoints (e.g., `ssh.hostname.mydomain.com`) |
| Hostname ID | `HOSTNAME_ID` | Unique per-device identifier for hostname-based software definitions |

All prompts have a 30-second timeout and auto-proceed with sensible defaults. Set `HEADLESS_INSTALL=true` to skip all prompts entirely.

## Software Definitions

The software / package definitions are all mapped in the [`software.yml`](https://github.com/heymegabyte/install.doctor/blob/master/software.yml) file defined in the root of the Install Doctor repository. The definitions for the *Basic*, *Standard*, and *Full* installations (as well as their desktop-only variants) are all defined in the [`home/.chezmoidata.yaml`](https://github.com/heymegabyte/install.doctor/blob/master/home/.chezmoidata.yaml) file. The *Basic* definition is found under the `_Basic` key in the `chezmoidata.yaml` file and the desktop variant is found under the `_Basic-Desktop` key in the file.

Depending on whether or not the script detects if the device is a workstation or not (i.e. whether or not it has an active display manager), UI-only tools will be installed. This detection is done in the [`home/.chezmoi.yaml.tmpl`](https://github.com/heymegabyte/install.doctor/blob/master/home/.chezmoi.yaml.tmpl) file.

### Customizing Software Definitions

If you would like to add more software definitions to the `software.yml` file, we encourage you to open a pull request and share your work with the Install Doctor community. We regularly analyze and integrate definitions.

If you would like to forego integrating your definitions into the public Install Doctor project, you will most likely want to create your own fork first. Then, you can also create a new file named `software-custom.yml` alongside the `software.yml` file. You should follow the same structure in `software.yml`. During the provisioning process, the installer will detect the presence of this file and merge it into `software.yml`, overwriting any overlapping keys in favor of the `software-custom.yml` file.

If you wanted to:

1. Add a new package that is available via `brew install newpackage`
2. Override the existing definition of imagemagick to only install using Homebrew
3. Only attempt to install imagemagick if the `convert` command is not available from the terminal

Then, the `software-custom.yml` file might look like this:

```yaml
---
softwarePackages:
  newpackage:
    brew: newpackage
  imagemagick:
    _bin: convert
    brew: imagemagick
```

For more details on creating software definitions, refer to the [Software customization](/docs/customization/software) section of the documentation.

### Mapping Software Definitions to Hostname

For truly headless installations that are customized to your software needs on a particular device, you can define a software list that will be used when the device's hostname ID or actual hostname are defined in the `home/.chezmoidata.yaml` file. You can create the definition by adding a new key to `home/.chezmoidata.yaml` named `__hostname__hostname`. You can search for `__hostname__office-tmpl` to see the list of software that would be installed by Install Doctor if the hostname ID or hostname are equal to `office-tmpl`.

If you wanted to configure Install Doctor to only install imagemagick on a device with a hostname ID or hostname equal to `mycomputer`, then you would have to add a section under the `softwareGroups` key in `home/.chezmoidata.yaml` that looks like this:

```yaml
...
softwareGroups:
  __hostname__mycomputer:
    - imagemagick
...
```

*Note: Even if you declare an empty list in the `softwareGroups` section, the Install Doctor dotfiles will still unpack (of course) and some other software that Install Doctor depends on will still be installed. Minimizing the installation of dependencies is something we pay careful attention to. Consider adding a feature request if your minimal installation is not to your liking.*

### Package Manager Preference

Many times, you will find software that can be installed by multiple package managers. In our `software.yml` file, we try to define every type of installation that is possible. This way, users can choose whether they want to install a package via the built-in system package manager or via Homebrew, for instance.

The default settings of Install Doctor are well-thought. We try to use package managers that are better known for their secure implementations like Flatpaks and Snaps before using installation methods like downloading from GitHub releases.

The order that the installer tries to use is defined in the `installerPreference` key of the `software.yml` file. You can customize it using the same method described above by utilizing the `software-custom.yml` file. For example, if you wanted to configure Ubuntu to only install packages via `apt-get` or `npm` and priorize `apt-get` over `npm` as the installation method, then you could include the following in your `software-custom.yml` file:

```yaml
---
installerPreference:
  ubuntu:
    - apt
    - npm
```

*Note: During the installation, the installer will ensure that any package managers required are installed. In other words, if the key in your `softwareGroups` (from `home/.chezmoidata.yaml`) contains a software key that is defined in either `software.yml` or `software-custom.yml` that only defines `brew` as a potential package manager to use, then the installer will first ensure Homebrew is installed. The installation of system package managers like `apt` or `dnf` are assumed to already be present on the system.*

### Full Example

> **Note:** The `softwarePackages` key in `software-custom.yml` is the current method for adding custom packages. Modify `software.yml` directly (or use `software-custom.yml` for overrides) to change default software installations.

If you wanted to customize the *Standard* install (mentioned above) to also include a package named `mypackage` and then automatically install that group of software on devices with the hostname of `sirius`, you would first create the package manager instruction file in `software-custom.yml` which would look like this:

```yaml
---
softwarePackages:
  mypackage:
    choco: mypackage-app
    brew: mypackage
    apt: mypackage-cli
```

Assuming you do not also modify the `installerPreference` which defines the order of which package manager to prefer on various systems, the definition above says to:

1. If the `apt` package manager is available, install `mypackage-cli` via `apt-get`
2. If `apt` was not available or not in the `installerPreference` list for the given system, then install `mypackage` via Homebrew.
3. If the system is a Windows system, then install `mypackage-app` via [Chocolatey](https://chocolatey.org/)

Next, you would modify `home/.chezmoidata.yaml` to include the following (with the `...`s omitted):

```yaml
...
softwareGroups:
  __hostname__sirius:
    - *Standard*
    - mypackage
...
```

Then, with these customizations saved to your fork on GitHub, you would run:

**Linux:**

```shell
export START_REPO=my-gh-user/my-fork-name
bash <(curl -sSL https://install.doctor/start)
```

**Windows:**

```powershell
$env:START_REPO = 'my-gh-user/my-fork-name'
iex ((New-Object System.Net.WebClient).DownloadString('https://install.doctor/windows'))
```

**Qubes:**

```shell
export START_REPO=my-gh-user/my-fork-name
qvm-run --pass-io sys-firewall "curl -sSL https://install.doctor/qubes" > ~/setup.sh && bash ~/setup.sh
```

## Automating the Prompts

Install Doctor allows you to pass many different user-specific and device-specific variables so that you can provision your devices completely headlessly (i.e. without any interaction). You can headlessly provision your devices by leveraging a combination of environment variables and / or encrypted secrets. For instance, if you want to headlessly provision your device the first time you run Install Doctor, then you could run one of the following blocks of code depending on your operating system:

**Linux / macOS:**

```shell
export HEADLESS_INSTALL=true
export SOFTWARE_GROUP=Standard-Desktop
export FULL_NAME="Joe Shmoe"
export PRIMARY_EMAIL="help@megabyte.space"
export PUBLIC_SERVICES_DOMAIN="megabyte.space"
export START_REPO=my-gh-user/my-fork-name
bash <(curl -sSL https://install.doctor/start)
```

**Windows:**

```powershell
$env:HEADLESS_INSTALL = true
$env:SOFTWARE_GROUP = Standard-Desktop
$env:FULL_NAME = 'Joe Shmoe'
$env:PRIMARY_EMAIL = 'help@megabyte.space'
$env:PUBLIC_SERVICES_DOMAIN = 'megabyte.space'
$env:START_REPO = 'my-gh-user/my-fork-name'
iex ((New-Object System.Net.WebClient).DownloadString('https://install.doctor/windows'))
```

**Qubes:**

```shell
export HEADLESS_INSTALL=true
export SOFTWARE_GROUP=Standard-Desktop
export FULL_NAME="Joe Shmoe"
export PRIMARY_EMAIL="help@megabyte.space"
export PUBLIC_SERVICES_DOMAIN="megabyte.space"
export START_REPO=my-gh-user/my-fork-name
qvm-run --pass-io sys-firewall "curl -sSL https://install.doctor/qubes" > ~/setup.sh
bash ~/setup.sh
```

### Customizing Variables / Secrets

For a list of variables that Install Doctor can integrate as well as details on how you can encrypt and store your variables inside your fork of Install Doctor, please refer to the [documentation on Secrets](/docs/customization/secrets).
