# [PSFzf](https://github.com/kelleyma49/PSFzf)
# [DockerCompletion](https://github.com/matt9ucci/DockerCompletion)

### Env
$env:EDITOR = 'code --wait'
$env:GIT_SSH = "C:\Windows\system32\OpenSSH\ssh.exe"

### Set PowerShell to UTF-8
[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

### PSReadLine
Set-PSReadLineOption -EditMode Vi
Set-PSReadLineOption -BellStyle None
Set-PSReadLineKeyHandler -Chord 'Ctrl+d' -Function DeleteChar
Set-PSReadLineOption -PredictionSource History

### Import PowerShell modules
$modules = @("Carbon", "ImportExcel", "Microsoft.PowerShell.ConsoleGuiTools", "Microsoft.PowerShell.PSResourceGet", "PSFzf", "PSWindowsUpdate", "PackageManagement", "PendingReboot", "posh-git", "Terminal-Icons")

foreach ($module in $modules) {
    if (-not (Get-Module -ListAvailable -Name $module)) {
        Install-Module -Name $module -Scope CurrentUser -Force -Repository PSGallery -AllowPrerelease
    }
    Import-Module $module -Force
}

### Carapace
Set-PSReadLineOption -Colors @{ "Selection" = "`e[7m" }
Set-PSReadlineKeyHandler -Key Tab -Function MenuComplete
carapace _carapace | Out-String | Invoke-Expression

### Homebrew
# TODO - Add for case where value is /opt/homebrew/bin/brew shellenv
Add-Content -Path $PROFILE.CurrentUserAllHosts -Value '$(/usr/local/bin/brew shellenv) | Invoke-Expression'

### posh-git settings
oh-my-posh init pwsh --config "$env:HOME/.config/oh-my-posh/Betelgeuse.omp.json" | Invoke-Expression

### PSFzf settings
Set-PsFzfOption -PSReadlineChordProvider 'Ctrl+t' -PSReadlineChordReverseHistory 'Ctrl+r'
Set-PsFzfOption -TabExpansion
$env:_PSFZF_FZF_DEFAULT_OPTS = "--ansi --preview 'bat --color=always {}'"
Set-PSFzfOption -EnableAliasFuzzySetEverything

### zoxide
Invoke-Expression (& { (zoxide init powershell | Out-String) })

### Aliases
Set-Alias grep Select-String

### Utilities
function which ($command) {
  Get-Command -Name $command -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
}

### Install Doctor command-not-found adapter (E04)
# Delegate a missing command to the SAME canonical bash resolver (~/.config/shell/not-found-hook.sh) in
# INSTALL-ONLY mode (CNF_NO_EXEC — bash cannot re-run into pwsh), then re-run the command IN PowerShell
# preserving arguments + exit status. A STILL-missing command does nothing here, so PowerShell emits its
# ordinary command-not-found error — NEVER a false success. Installs only in an INTERACTIVE, non-CI
# session (E13); the approved-interactive context is signalled to the resolver with
# CNF_ALLOW_NONINTERACTIVE=1 (the bash child is itself non-interactive). Where bash is absent (native
# Windows), it no-ops to ordinary not-found — a choco/scoop lazy path is a separate follow-up.
$ExecutionContext.InvokeCommand.CommandNotFoundAction = {
  param($CommandName, $CommandLookupEventArgs)
  if (-not [Environment]::UserInteractive) { return }
  if ($env:CI) { return }
  $hook = Join-Path $HOME '.config/shell/not-found-hook.sh'
  if (-not (Test-Path $hook)) { return }
  if (-not (Get-Command bash -ErrorAction SilentlyContinue)) { return }
  # install-only via the ONE resolver; all install/status chatter -> stderr (keep stdout clean)
  & env CNF_ALLOW_NONINTERACTIVE=1 CNF_NO_EXEC=1 bash -c 'source "$1"; __cnf_resolve "$2"' _ $hook $CommandName 1>&2
  if (Get-Command $CommandName -CommandType Application -ErrorAction SilentlyContinue) {
    # installed -> re-run the exact command in pwsh, preserving arguments + exit status
    $CommandLookupEventArgs.CommandScriptBlock = {
      & (Get-Command $CommandName -CommandType Application) @args
    }.GetNewClosure()
    $CommandLookupEventArgs.StopSearch = $true
  }
  # still missing -> fall through to PowerShell's ordinary CommandNotFoundException (no false success)
}
