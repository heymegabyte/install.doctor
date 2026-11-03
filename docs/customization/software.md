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

VIM plugins can be defined in the `home/.chezmoidata.yaml` file. The following is an example defining two plugins that will be automatically installed and integrated into VIM:

```
softwarePlugins:
  vim:
    plugins:
      - https://github.com/dense-analysis/ale.git
      - https://github.com/pearofducks/ansible-vim.git
```

## Defining Packages

After reading our [Customization](/customization) documentation, you will begin to realize how easy it is to define software package installations across many different operating systems. This can be done with very little code by editing the YAML definitions either in the `software.yml` file (if you decide to open a pull request so that the definitions can be made available to everyone) or in the `software-custom.yml` file that can contain definitions that you do not wish to contribute.

There are a handful of ways to customize the definitions. You can make definitions that will only use a certain method on a specific operating system, add pre-install / post-install logic, and more. The particulars are outlined below as well as in comments at the top of the `software.yml` file. Similarly, the following video walks through the process of creating new software definitions in either `software.yml` or `software-custom.yml`:

<iframe width="100%" height="430" src="https://www.youtube-nocookie.com/embed/UHpoYumybeY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

### Package Managers

Each package definition can (and should) contain definitions for every type of install method. The following example includes a definition that, in theory, can be installed by every type of package manager.

```yaml
---
softwarePackages:
  altair:
    ansible: professormanhattan.docker
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
    script: >-
      curl -sS https://getcomposer.org/installer | php
      sudo mv composer.phar /usr/local/bin/composer
      sudo chmod +x /usr/local/bin/composer
    snap: altair
    whalebrew:
    winget: Neovim.Neovim
    xbps: altair
    yay: altair
    zypper: altair
```

All of the package definitions above can be either strings, arrays, or even blocks of code, in the case of the `script` definition. You can find out more about each of the package managers that are supported by referring to the table below:

| Package Manager | Description |
| --------------- | ----------- |
| `ansible` | Downloads the Ansible role from Ansible Galaxy (uses the [Gas Station](https://github.com/megabyte-labs/gas-station) project for roles that are prefixed by `professormanhattan.`) |
| `apk` | Linux Alpine system package manager |
| `appimage` | AppImages installed by [Zap](https://github.com/srevinsaju/zap) |
| `basher` | Packages installed by [Basher](https://github.com/basherpm/basher) |
| `binary` | Direct URL to package binary |

#### AppImages

Browsing through the `software.yml` file, you might notice `appimage` definitions defined several different ways. [Zap](https://github.com/srevinsaju/zap) is used to install AppImages so you can install AppImages any way that Zap supports. This includes direct links to the AppImage file as well as simple names if the AppImage is in the [AppImage catalog](https://g.srev.in/get-appimage/) that Zap supports.

#### Scripts

You can define scripts in the YAML that handle the installation. These scripts should be defined similar to how the script is defined in the example above by beginning the code block with `>-` and a line return.

#### Package Manager Preference

The preference of which package manager to use during the installation process is defined by the `installerPreference` `software.yml` variable. There are more details on this on the [Customization](/docs/customization) page.

#### Package Manager Installation

If the preferred package manager determined by the `installerPreference` variable is not available on the system, then the installer will install the package manager prior to using it to install the package. The installation method can be determined by inspecting the [source of the ZX-based installer](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_local/bin/executable_install-program).
