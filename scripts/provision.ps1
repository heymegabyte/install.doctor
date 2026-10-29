#Requires -Version 5.1
<#
.SYNOPSIS
  Install Doctor — native Windows PowerShell bootstrap entrypoint.
.DESCRIPTION
  Windows counterpart of scripts/provision.sh (the bash bootstrap that https://install.doctor/start
  serves). The redirect https://install.doctor/windows points here. It ensures a Windows package
  manager (winget, with a scoop/choco fallback), installs the bootstrap dependencies git + chezmoi,
  then hands provisioning to chezmoi — mirroring the POSIX bootstrap intent (detect -> ensure deps ->
  chezmoi) natively, without requiring bash or WSL.

  Run it:
    irm https://install.doctor/windows | iex
    powershell -ExecutionPolicy Bypass -File scripts\provision.ps1

  Honors the same environment contract as provision.sh:
    START_REPO / REPO    fork URL or <user>/<repo> shorthand (default: the official heymegabyte repo)
    HEADLESS_INSTALL      'true' => skip interactive prompts and use defaults
    CI / TEST_INSTALL     non-interactive CI mode (implies headless chezmoi)

  STATUS: experimental — the native-Windows chezmoi path is early. No secret VALUE is ever printed.
.NOTES
  App and pairing: https://app.install.doctor
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ---- styled, secret-safe logging -----------------------------------------------------------------
function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }
function Write-Err  { param([string]$Message) Write-Host "    $Message" -ForegroundColor Red }

# ---- environment contract (parity with provision.sh) ---------------------------------------------
$Headless       = ($env:HEADLESS_INSTALL -eq 'true')
$NonInteractive = $Headless -or (-not [string]::IsNullOrEmpty($env:CI)) -or (-not [string]::IsNullOrEmpty($env:TEST_INSTALL))

function Resolve-StartRepo {
  # START_REPO wins; else REPO; else the official repo. A <user>/<repo> shorthand becomes a full URL.
  $repo = $env:START_REPO
  if ([string]::IsNullOrWhiteSpace($repo)) { $repo = $env:REPO }
  if ([string]::IsNullOrWhiteSpace($repo)) { return 'https://github.com/heymegabyte/install.doctor.git' }
  if ($repo -match '://' -or $repo -match '@') { return $repo }
  if ($repo -match '/') {
    if ($repo -match '\.git$') { return "https://github.com/$repo" }
    return "https://github.com/$repo.git"
  }
  return "https://github.com/$repo/install.doctor.git"
}

# ---- native detection: OS / arch / privilege -----------------------------------------------------
function Test-IsWindows {
  $v = Get-Variable -Name 'IsWindows' -ValueOnly -ErrorAction SilentlyContinue
  if ($null -ne $v) { return [bool]$v }
  return ($env:OS -eq 'Windows_NT')
}

function Get-Arch {
  switch -Regex ("$env:PROCESSOR_ARCHITECTURE") {
    'ARM64'     { return 'arm64' }
    'AMD64|x64' { return 'amd64' }
    'x86|386'   { return '386' }
    default     { return "$env:PROCESSOR_ARCHITECTURE" }
  }
}

function Test-Admin {
  try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
  } catch {
    return $false
  }
}

function Test-HasCommand { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# ---- package-manager abstraction: winget -> scoop -> choco ----------------------------------------
function Get-PackageManager {
  if (Test-HasCommand 'winget') { return 'winget' }
  if (Test-HasCommand 'scoop')  { return 'scoop' }
  if (Test-HasCommand 'choco')  { return 'choco' }
  return $null
}

function Install-Dependency {
  param([string]$WingetId, [string]$ScoopId, [string]$ChocoId, [string]$Command)
  if (Test-HasCommand $Command) { Write-Ok "$Command already present (skipping)"; return }
  $mgr = Get-PackageManager
  switch ($mgr) {
    'winget' { winget install --id $WingetId --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Null }
    'scoop'  { scoop install $ScoopId | Out-Null }
    'choco'  { choco install $ChocoId -y | Out-Null }
    default  { throw "No supported package manager (winget/scoop/choco). Install $Command manually, then re-run." }
  }
  Write-Ok "installed $Command via $mgr"
}

# ---- main ----------------------------------------------------------------------------------------
Write-Step 'Install Doctor — Windows bootstrap (https://install.doctor/windows)'

if (-not (Test-IsWindows)) {
  Write-Err 'This entrypoint is for native Windows. On macOS/Linux use: bash <(curl -sSL https://install.doctor/start)'
  exit 1
}

$arch    = Get-Arch
$isAdmin = Test-Admin
$repoUrl = Resolve-StartRepo
Write-Ok "architecture: $arch"
Write-Ok "elevation:    $(if ($isAdmin) { 'Administrator' } else { 'standard user' })"
Write-Ok "repository:   $repoUrl"
Write-Ok "mode:         $(if ($NonInteractive) { 'non-interactive' } else { 'interactive' })"

if (-not (Get-PackageManager)) {
  Write-Err 'winget is required (ships with App Installer on Windows 10 1709+ and Windows 11).'
  Write-Err 'Install "App Installer" from the Microsoft Store, or install scoop/choco, then re-run.'
  exit 1
}
Write-Ok "package manager: $(Get-PackageManager)"

Write-Step 'Ensuring bootstrap dependencies (git, chezmoi)'
Install-Dependency -WingetId 'Git.Git'        -ScoopId 'git'     -ChocoId 'git'     -Command 'git'
Install-Dependency -WingetId 'twpayne.chezmoi' -ScoopId 'chezmoi' -ChocoId 'chezmoi' -Command 'chezmoi'

# winget may install to a path not yet on the current session PATH.
foreach ($p in @("$env:ProgramFiles\Git\cmd", "$env:LOCALAPPDATA\Microsoft\WinGet\Links")) {
  if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) { $env:Path = "$env:Path;$p" }
}

if (-not (Test-HasCommand 'chezmoi')) {
  Write-Err 'chezmoi is not on PATH after install. Open a new terminal and re-run, or add it to PATH.'
  exit 1
}

# CI implies a headless chezmoi run (parity with provision.sh: CI => predefined defaults).
if ($NonInteractive -and [string]::IsNullOrEmpty($env:HEADLESS_INSTALL)) { $env:HEADLESS_INSTALL = 'true' }

Write-Step 'Handing off to chezmoi (dotfile + script provisioning)'
chezmoi init --apply $repoUrl

Write-Step 'Bootstrap complete'
Write-Ok 'Pair this machine and manage it at: https://app.install.doctor'
if (Test-HasCommand 'wsl') {
  Write-Ok 'WSL detected — the POSIX path (bash <(curl -sSL https://install.doctor/start)) also works inside WSL.'
}
