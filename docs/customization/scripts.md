---
title: Implementing Scripts
description: Learn how to incorporate new shell scripts into your own customized version of Install Doctor. Find out how the scripts are ordered, how to conditionally run them, and discover Go templating tricks.
sidebar_label: Scripts
slug: /customization/scripts
---

Install Doctor leverages shell scripting for many of the complex tasks that cannot easily be accommodated by the Install Doctor [ZX-based installer](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_local/bin/executable_install-program). On macOS / Linux / *nix variants Bash is used and, on Windows, PowerShell is also leveraged. Since Install Doctor is a [Chezmoi](https://www.chezmoi.io/)-based installer, all of the Chezmoi features and syntaxes are used by the scripts housed in the Install Doctor repository. After parsing script templates and filtering files with the `.chezmoiignore` file, all the scripts with file names that begin with `run_` are executed at different phases during the provisioning process.

## Script Phases

Scripts are run in three phases. The first phase is the start script. This is the code that runs when you run `curl -fsSL https://app.install.doctor/start | bash`. The second phase begins when the start script begins the Chezmoi provisioning process. In this second phase, all the scripts that contain `before_` in their file name run (that in stored somewhere under `home/` in the Install Doctor repository). Then, after Chezmoi applies all the configuration (i.e. dotfile) changes, the scripts that contain `after_` in their file name are run.

In summary:

1. Install Doctor bootstrap script runs
2. Scripts with names that include `before_` are run by Chezmoi
3. Chezmoi provisions the dotfiles / configuration files
4. Scripts with names that include `after_` are run by Chezmoi

## Chezmoi Scripts Folder

Almost all of the scripts used during the provisioning process are located in the `home/.chezmoiscripts/` folder. In that folder, you will see different folders that correspond to different operating systems. Scripts placed in these folders will only run on the corresponding operating system. There are a handful of scripts that are located close to the files they relate to. That said, placing scripts in the `home/.chezmoiscripts/` folder is preferred since it is more easily managed.

## Script Order

Apart from designating scripts to run `before_` or `after_` the Chezmoi provisioning process, Chezmoi processes the various scripts synchronously in file-system-based alphabetical order. This is why there is a `_universal` and `universal` folder in the `home/.chezmoiscripts/` folder. The `_universal` scripts need to run first so their folder name contains the starting `_` to make the folder first in the alphabetical order. Then, all the scripts that do not need to run before anything else in the `.chezmoiscripts/` folder are placed in the `universal` folder.

## Running Scripts Conditionally

Chezmoi allows you to add a file name label called `onchange_`. This file name descriptor instructs Chezmoi to compare the rendered value of that script to the rendered value of that script when it was last executed. So, if you have a script located in `home/.chezmoiscripts/universal/run_onchange_before_01-test.sh.tmpl` that looks like this:

```shell
#!/usr/bin/env bash

echo "Install Doctor rocks!"
```

Then, the second time you run `chezmoi apply` or use the quick start script (i.e. `curl -fsSL https://app.install.doctor/start | bash` for standard macOS / Linux provisioning), the script will bypass the script execution since the script was already run and has not changed.

### Conditional Script Usage Example

The `onchange_` flag for scripts is useful when you have code that should run the first time and then anytime there is a particular type of change in the state of the device. For example, the [`home/.chezmoiscripts/universal/run_onchange_after_12-install-packages.tmpl`](https://github.com/heymegabyte/install.doctor/blob/master/home/.chezmoiscripts/universal/run_onchange_after_12-install-packages.tmpl) script runs anytime there is a change to the list of software that the user wants installed on the target system. It accomplishes this by injecting the list of software that should be installed as a Bash comment in the script via [Go Sprig](http://masterminds.github.io/sprig/) templating (which is what is used when a file ends with `.tmpl`). *Note: Go Sprig functions can be combined with the [functions that Chezmoi provides](https://www.chezmoi.io/reference/templates/functions/).*

### Conditional Script Advanced Example

In another more complex example, a script that ensures fonts are added to the appropriate location on macOS only runs when the SHA256 hash sum for any of the fonts has changed. This file looks like this:

```shell
{{- if eq .host.distro.family "darwin" -}}
#!/usr/bin/env bash

{{ includeTemplate "universal/profile" }}
{{ includeTemplate "universal/logg" }}

{{ $fontFiles := (output "find" (joinPath .chezmoi.homeDir ".local" "share" "fonts") "-type" "f") -}}
{{- range $fontFile := splitList "\n" $fontFiles -}}
{{- if ne $fontFile "" -}}
# {{ $fontFile }} hash: {{ $fontFile | sha256sum }}
{{ end -}}
{{- end }}

### Ensure all fonts are added to ~/Library/Fonts on macOS
find "$HOME/.local/share/fonts" -type f | while read FONT_FILE; do
  BASENAME="$(basename "$FONT_FILE")"
  if [ ! -f "$HOME/Library/Fonts/$BASENAME" ] || [ "$(openssl sha256 "$HOME/Library/Fonts/$BASENAME" | sed 's/.*= //')" != "$(openssl sha256 "$FONT_FILE" | sed 's/.*= //')" ]; then
    gum log -sl info 'Adding '"$BASENAME"' to ~/Library/Fonts'
    cp "$FONT_FILE" "$HOME/Library/Fonts/$BASENAME"
  fi
done

{{ end -}}
```

If you are trying to trigger an `onchange_` script whenever any file in a given folder has changed, you might have some luck looking at this [issue posted on the Chezmoi GitHub repository](https://github.com/twpayne/chezmoi/issues/2741).

### Conditional Script Philosophy

This method should be used whenever possible. Using Go Sprig templating, all the input sources that impact a script's side effects should be quantized and injected as a comment. The end result we are looking for is allowing the user to confidently make a change to any file and then have the side effects of that file's presence propagated out regardless of whether or not the script was already run.

Only running scripts when they need to run will improve provisioning times and perhaps one day lead to the ability to apply updates in the real time. However, to implement this feature, all the scripts need to have templated comments that change when any of the scripts' inputs change. *This enhancement is currently a work in progress and [pull requests](/docs/contributing/pull-requests) are certainly welcome.*

## Go Templating

If you are new to Go templating, you might soon find out that there are not many informative guides on how to use Go templating. Most of the guides reference actual Go code and do not focus on the Go template syntax that is used by Chezmoi. This [guide by HashiCorp on Go templating](https://developer.hashicorp.com/nomad/tutorials/templates/go-template-syntax) might be a useful place to get your feet wet. Apart from that, you can sift through the code in this project for examples and verse yourself with the functions / directives that are available to Chezmoi. These functions / directives are listed on the [Go Sprig documentation](http://masterminds.github.io/sprig/) and are augmented by the [custom functions that Chezmoi provides](https://www.chezmoi.io/reference/templates/functions/).

### Double Bracket Minus Syntax

You might notice that the sample code shown above in the Conditional Script Advanced Example section uses bracket signs that are either prefixed or postfixed by minus signs. All Go template bindings are surrounded by `{{` and `}}` but the code above also uses `{{-` and `-}}`. These additions of minus signs instruct the Go template engine to strip all white space before the binding in the case of `{{-` and strip all white space after the binding in the case of `-}}`. This white space includes line endings.

In the script above, the `{{-` and `-}}` are required on the first line because if the white space was not stripped then the Bash shebang would be on the second line of the file after going through the Go template engine that Chezmoi provides. This would result in an invalid script. The minus sign in the last line (i.e. `{{ end -}}`) is actually not technically necessary because Bash scripts can end in any number of white space characters, including newlines. However, it is a good idea to trim the whitespace so that browsing through debug files does not fill your terminal up with new lines.

### Creating Conditional Symlinks

Another place where the use of `{{-` and `-}}` is necessary is when you are creating a file that should be empty of any characters if certain templating conditions fail. For instance, take the [`home/dot_local/bin/symlink_bat.tmpl`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_local/bin/symlink_bat.tmpl) file as an example. It contains the following code:

```shell
{{- if (eq .host.distro.id "ubuntu") -}}
/usr/bin/batcat
{{- end -}}
```

If the system is Ubuntu-based, then the symlink will be created. However, if the system is not Ubuntu then the symlink will not be created because all the white space in the file will be stripped. This will produce a completely empty file and Chezmoi ignores completely empty templated files. If the minus signs were omitted, the `symlink_` file would be parsed to be an empty file with some new lines and an error would occur.
