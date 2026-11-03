---
title: Profile Scripts Overview
description: Learn about how Install Doctor incorporates well-thought, meticulously organized, and performant Bash / ZSH profile and environment setup scripts.
sidebar_label: Profile Scripts
slug: /scripts/profile
---

Install Doctor's expertly configured and optimized system configuration collection includes masterfully created Bash / ZSH profile scripts. These scripts are separated into a handful of files that are only imported when necessary.

The default configuration ensures ZSH is the default shell. When combined with the [Oh-My-ZSH](https://ohmyz.sh/) framework, this gives the user access to advanced auto-completion, type ahead, and predictive features.

A well-optimized Bash configuration is also provided for cases where a simpler terminal shell engine might be more desirable. Bash makes use of the [Bash It!](https://github.com/Bash-it/bash-it) framework.

## Profile Scripts

The Bash / ZSH entrypoint scripts are stored at `~/.bashrc` and `~/.zshrc`. Both of these configurations include imports that reference a few different files located in the `home/dot_config/shell/` folder. This way, shell initialization code that should be common to both the Bash and ZSH configurations is stored in a single file, reducing duplicate code. Bash-specific and ZSH-specific configuration logic is stored in their respective `~/.*rc` files.

The following chart outlines the purpose of the various shared profile setup scripts:

| File Path                        | Description                                                        |
|----------------------------------|--------------------------------------------------------------------|
| [`~/.config/shell/aliases.sh`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/shell/aliases.sh.tmpl) | Stores command aliases / shortcuts |
| [`~/.config/shell/exports.sh`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/shell/exports.sh.tmpl) | Houses all the environment variables |
| [`~/.config/shell/functions.sh`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/shell/functions.sh.tmpl) | Stored all the functions / more-complicated aliases |
| [`~/.config/shell/motd.sh`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/shell/motd.sh.tmpl) | Includes code that invokes a useful, pretty MOTD |
| [`~/.config/shell/private.sh`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/shell/private.sh.tmpl) | Stores environment variables that are intended to be private (e.g. API keys) |
| [`~/.config/shell/profile.sh`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/shell/profile.sh.tmpl) | Main profile script that is invoked by `~/.bashrc` and `~/.zshrc` that includes all of the other scripts as well as some other initialization logic |

## Related Links

* [Profile scripts folder](https://github.com/heymegabyte/install.doctor/tree/master/home/dot_config/shell)
* [`~/.bashrc` source file](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_bashrc)
* [`~/.zshrc` source file](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_zshrc)
