#!/usr/bin/env bash
# R09: production helpers may not acquire executable authority from mutable,
# unauthenticated network responses. Unsupported optional features must fail
# explicitly until their exact bytes are admitted by the signed release plan.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

reject_pattern() {
  local label="$1" pattern="$2"; shift 2
  local hit file
  for file in "$@"; do
    if [ ! -f "$file" ]; then fail "$label: monitored file missing: $file"; return; fi
  done
  hit="$(grep -nE -- "$pattern" "$@" 2>/dev/null | head -1 || true)"
  if [ -z "$hit" ]; then pass "$label"; else fail "$label: $hit"; fi
}

require_pattern() {
  local label="$1" pattern="$2"; shift 2
  local hit file
  for file in "$@"; do
    if [ ! -f "$file" ]; then fail "$label: monitored file missing: $file"; return; fi
  done
  hit="$(grep -nE -- "$pattern" "$@" 2>/dev/null | head -1 || true)"
  if [ -n "$hit" ]; then pass "$label"; else fail "$label"; fi
}

SYSTEM_HELPERS=(
  "$ROOT/home/dot_config/system/usr/local/bin/executable_git-sync"
  "$ROOT/home/dot_config/system/usr/local/bin/executable_zfs-r2"
)
reject_pattern 'system helpers never source a downloaded library' \
  'public\.megabyte\.space/source\.sh|(curl|wget).*\$U' "${SYSTEM_HELPERS[@]}"
reject_pattern 'system helpers cannot self-update outside signed desired state' \
  'se_self_update|refs/heads/(master|main)' "${SYSTEM_HELPERS[@]}"

reject_pattern 'pfSense automation contains no moving-branch pipe-to-shell' \
  'raw\.githubusercontent\.com/.*/(master|main)/.*\|[[:space:]]*(ba)?sh' \
  "$ROOT/scripts/pfsense.sh" "$ROOT/scripts/partials/pfsense-unifi"
reject_pattern 'pfSense automation contains no latest-release install URL' \
  '/releases/latest/' "$ROOT/scripts/pfsense.sh" "$ROOT/scripts/partials/pfsense-saml"

reject_pattern 'Cua opt-in cannot execute its mutable web installer' \
  'cua\.ai/install\.sh|bash[[:space:]]+"\$tmp_installer"' \
  "$ROOT/home/dot_local/bin/post-installx/executable_post-cua-driver.sh"
reject_pattern 'terminal theme cannot evaluate network-fetched Python' \
  'python3[[:space:]]+-c[[:space:]]+"\$\((curl|wget)|Gogh-Co/Gogh/(master|main)' \
  "$ROOT/home/dot_local/bin/executable_install-terminal-theme.tmpl"
reject_pattern 'npm project initialization has no remote Taskfile execution' \
  'gitsync\.org/init|Taskfile-init\.yml' "$ROOT/home/dot_config/npm/config/npm-init.js"
reject_pattern 'workstation setup contains no latest Emdash executable' \
  'generalaction/emdash/releases/latest/' \
  "$ROOT/home/dot_local/bin/post-installx/executable_post-workstation.sh"
reject_pattern 'VMware setup contains no latest-release root patch execution' \
  'DrDonk/unlocker/releases/latest|sudo[[:space:]]+\./unlock' \
  "$ROOT/home/dot_local/bin/post-installx/executable_post-vmware.sh"
reject_pattern 'JumpCloud enrollment cannot pipe a keyed response to root shell' \
  'kickstart\.jumpcloud\.com/Kickstart|\|[[:space:]]*sudo[[:space:]]+bash' \
  "$ROOT/home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl"

DOC_FILES=()
while IFS= read -r file; do DOC_FILES+=("$file"); done < <(find "$ROOT/.config/docs" "$ROOT/docs" -type f 2>/dev/null)
DOC_FILES+=("$ROOT/.vscode/tasks.json")
reject_pattern 'documentation and editor tasks contain no legacy remote execution endpoints' \
  'install\.doctor/(quickstart|windows-quickstart|windows-client|qubes)([^[:alnum:]_-]|$)|bash[[:space:]]*<\(curl|DownloadString\(' \
  "${DOC_FILES[@]}"
reject_pattern 'documentation never recommends remote command substitution' \
  '(ba)?sh[[:space:]]+-c[[:space:]]+"\$\(curl' "${DOC_FILES[@]}"

for workflow in "$ROOT/.github/workflows/site-deploy.yml" "$ROOT/.github/workflows/site-preview.yml"; do
  if grep -q '3bda94dbe6efb789c8c5349e0d554c8f7841611ee0ff2c34a757541262d1c033' "$workflow" \
    && grep -q '11466' "$workflow"; then
    pass "$(basename "$workflow") binds shdoc bytes by size and SHA-256"
  else
    fail "$(basename "$workflow") does not bind shdoc bytes by size and SHA-256"
  fi
done

HOMEBREW_BOOTSTRAPS=(
  "$ROOT/scripts/homebrew.sh"
  "$ROOT/scripts/cloudflared-ssh.sh"
  "$ROOT/scripts/partials/homebrew"
  "$ROOT/home/.chezmoiscripts/universal/run_before_02-homebrew.sh.tmpl"
)
for bootstrap in "${HOMEBREW_BOOTSTRAPS[@]}"; do
  if grep -q '5f333bbe53bc490e51e7ccb1df8779b3dd6ee73a1a7379efda216edb08ccb148' "$bootstrap" \
    && grep -qE '(sha256sum|shasum)' "$bootstrap" \
    && grep -q '1048576' "$bootstrap"; then
    pass "${bootstrap#"$ROOT/"} verifies the pinned Homebrew installer"
  else
    fail "${bootstrap#"$ROOT/"} executes Homebrew without exact digest and size verification"
  fi
done
reject_pattern 'local launcher leaves package acquisition to signed desired state' \
  '(brew|apt-get|dnf|yum|pacman|apk|snap)[[:space:]]+(install|add|-S)|xcode-select[[:space:]]+--install' \
  "$ROOT/start.sh"

SYSTEM_BOOTSTRAP="$ROOT/home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl"
if grep -q '3fa0d96428d1e013b13be11c321ff912ae31860f09eb8ac2a5fd75f8946bdff2' "$SYSTEM_BOOTSTRAP" \
  && grep -q '1579992' "$SYSTEM_BOOTSTRAP"; then
  pass 'Docker credential helper is bound by exact SHA-256 and size'
else
  fail 'Docker credential helper lacks exact immutable artifact authority'
fi

KASMVNC_HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-kasmvnc.sh"
if grep -q '89a5d1fbe9e032b122202be158a2b25f15c97e0a5b8dcf92a5e6835c7b7b2acd' "$KASMVNC_HOOK" \
  && grep -q '2687950' "$KASMVNC_HOOK"; then
  pass 'KasmVNC package is bound by exact SHA-256 and size'
else
  fail 'KasmVNC package lacks exact immutable artifact authority'
fi

BACKREST_HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-backrest.sh"
if grep -q 'acc7835a9c55b3d254f0fa285cacbe87ac912cb7e069d0211924838020e6921c' "$BACKREST_HOOK" \
  && grep -q 'b53718cd6e042e7d99538cb652968ab966a5c53fabd556785648ceb13320a320' "$BACKREST_HOOK" \
  && ! grep -qE 'curl[^|]*\|[[:space:]]*tar' "$BACKREST_HOOK"; then
  pass 'Backrest archives are platform-pinned and verified before extraction'
else
  fail 'Backrest archive authority is incomplete'
fi

RUNNER_HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-github-runners.sh"
if { grep -q 'b13b784808359f31bc79b08a191f5f83757852957dd8fe3dbfcc38202ccf5768' "$RUNNER_HOOK" \
    && grep -q '119302750' "$RUNNER_HOOK" \
    && ! grep -qE 'curl[^|]*\|[[:space:]]*.*tar' "$RUNNER_HOOK"; } \
  || { grep -q 'self-hosted runner provisioning is unsupported until typed enrollment' "$RUNNER_HOOK" \
    && ! grep -qE 'curl|tar[[:space:]]+-|GITHUB_RUNNER_REG_TOKEN|config\.sh[[:space:]]+--' "$RUNNER_HOOK"; }; then
  pass 'GitHub Actions runner artifact execution is pinned or explicitly unavailable'
else
  fail 'GitHub Actions runner artifact authority is incomplete'
fi

WORKSTATION_HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-workstation.sh"
reject_pattern 'Workstation configuration hook cannot bypass selected desired state' \
  'mise use|go install|npm (uninstall|install) -g|rustup component add|releases/download|auto-updater|agy"? update|gh repo clone' \
  "$WORKSTATION_HOOK"
require_pattern 'Workstation destructive cleanup requires explicit consent' \
  'INSTALL_DOCTOR_CONSENT_REMOVE_LEGACY' \
  "$WORKSTATION_HOOK"
require_pattern 'Workstation capability is lazy and explicitly selected' \
  'INSTALL_DOCTOR_ENABLE_WORKSTATION' \
  "$WORKSTATION_HOOK"
require_pattern 'Workstation typed phases fail pending before legacy mutation' \
  '--check\|--apply\|--verify' "$WORKSTATION_HOOK"
reject_pattern 'Workstation provisioning never clears ZFS error evidence or prunes recovery points under pressure' \
  'zpool clear|zfs destroy' "$WORKSTATION_HOOK"
reject_pattern 'workstation hooks never acquire fonts from a moving branch' \
  'powerlevel10k-media/raw/(master|main)|raw\.githubusercontent\.com/.*/(master|main)/.*\.(ttf|otf)' \
  "$WORKSTATION_HOOK" "$ROOT/home/dot_local/bin/post-installx/executable_post-zsh-bootstrap.sh"
reject_pattern 'bootstrap loggers never acquire optional presentation executables' \
  'install(Gum|Glow)|charmbracelet/(gum|glow)/releases|brew install( --quiet)? (gum|glow)|curl.*(GUM|GLOW)_DOWNLOAD_URL' \
  "$ROOT/.config/log" "$ROOT/home/.chezmoitemplates/universal/logg-inline"
reject_pattern 'Chezmoi hooks never source predictable helpers from world-writable temporary paths' \
  '/tmp/tmp-(logg|profile)' \
  "$ROOT/home/.chezmoitemplates/universal/logg-before" \
  "$ROOT/home/.chezmoitemplates/universal/profile-before" \
  "$ROOT/home/.chezmoiscripts/universal/run_before_01-prepare.sh.tmpl"
reject_pattern 'bootstrap never persists a mutable network command in shell startup' \
  '(echo|printf).*(app\.install\.doctor/start|install\.doctor/start).*(zshrc|profile)|TEMPORARY FOR INSTALL DOCTOR MACOS' \
  "$ROOT/scripts/partials/full-disk-access" "$ROOT/scripts/provision.sh" \
  "$ROOT/home/.chezmoiscripts/universal/run_before_02-homebrew.sh.tmpl"
reject_pattern 'local launcher never mutates source authority or persists credentials' \
  'git (fetch|pull)|remote set-url.*TOKEN|printenv' "$ROOT/start.sh"
reject_pattern 'local launcher does not create a secondary runtime authority' \
  'volta install|brew install|snap install' "$ROOT/start.sh"
reject_pattern 'preliminary system hook never mutates system Python packages' \
  'pip(3)?[[:space:]]+install|python3[[:space:]]+-m[[:space:]]+pip[[:space:]]+install' \
  "$ROOT/home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl"
reject_pattern 'preliminary system hook never acquires packages, repositories, or runtimes' \
  '(brew[[:space:]]+install|snap[[:space:]]+install|flatpak[[:space:]]+remote-add|rustup-init[[:space:]]+-y|rustup[[:space:]]+default)' \
  "$ROOT/home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl"
reject_pattern 'desktop pre-install hook never acquires packages or updates language runtimes' \
  '(apt-get|dnf|pacman|brew)[[:space:]]+(install|-S|-Syu)|gem[[:space:]]+update[[:space:]]+--system' \
  "$ROOT/home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl"
reject_pattern 'post-install configuration never acquires default-browser tooling' \
  'brew[[:space:]]+install[^\n]*defaultbrowser' \
  "$ROOT/home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl"
reject_pattern 'offline secret compatibility hook never acquires age or expect' \
  'brew[[:space:]]+install[^\n]*(age|expect)' \
  "$ROOT/home/.chezmoiscripts/universal/run_before_03-decrypt-age-key.sh.tmpl"
reject_pattern 'GNOME extension planning uses no predictable shared temporary file' \
  '/tmp/install-gnome-extensions\.txt' \
  "$ROOT/home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl"
reject_pattern 'compatibility requirements hook never owns package or repository mutation' \
  '(brew|apt-get|dnf|pacman|zypper|pkg|npm|go|rustup)[[:space:]]+(install|tap|upgrade|add)|rpmfusion|brewInstallSafely' \
  "$ROOT/home/.chezmoiscripts/universal/run_before_04-requirements.sh.tmpl"
reject_pattern 'VS Code configuration never performs ambient dependency installation' \
  'npm (i([[:space:]]|$)|install([[:space:]]|$))|sudo cp.*[[:space:]]/package\.json|cp.*\$HOME/package\.json' \
  "$ROOT/home/dot_local/bin/post-installx/executable_post-vscode.sh"
reject_pattern 'GNOME settings never evaluate configuration as shell code' \
  'eval[[:space:]]+"?\$EXT_SETTING' \
  "$ROOT/home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl"
reject_pattern 'Workstation configuration never starts mutable-tag containers or pulls mutable models' \
  'docker run.*(willfarrell/autoheal|grafana/alloy)|ollama pull|nomic-embed-text:latest' \
  "$WORKSTATION_HOOK" "$ROOT/home/dot_local/bin/post-installx/executable_post-ollama.sh"

QUBES_TEMPLATES="$ROOT/home/.chezmoiscripts/qubes/run_before_51-install-templates.sh.tmpl"
reject_pattern 'Qubes dom0 path has no mutable latest-release artifact' \
  'mirageUrl|qubes-mirage-firewall/releases/latest' "$QUBES_TEMPLATES" "$ROOT/home/.chezmoidata.yaml"
reject_pattern 'Qubes dom0 path never bypasses RPM signature verification' \
  'dnf install --nogpgcheck' "$QUBES_TEMPLATES"
require_pattern 'Mirage firewall bytes are pinned by SHA-256' \
  'a2be6be545412daf4af794e1ca6ac4f4a93d4eaf9e41f9429ed438e59762d350' \
  "$QUBES_TEMPLATES" "$ROOT/home/.chezmoidata.yaml"
QUBES_HOOKS=("$ROOT"/home/.chezmoiscripts/qubes/*.tmpl)
reject_pattern 'unsupported Qubes Chezmoi hooks cannot mutate packages, repositories, Salt, RPC policy, services, or devices' \
  '(qubes-dom0-update|qubesctl[[:space:]]+(state|top|--)|apt-get[[:space:]]+(update|install)|dnf[[:space:]]+install|qvm-pci[[:space:]]+attach|tee[[:space:]]+/etc/qubes|cp[[:space:]].*/etc/)' \
  "${QUBES_HOOKS[@]}"
for qubes_hook in "${QUBES_HOOKS[@]}"; do
  require_pattern "$(basename "$qubes_hook") fails explicitly while Qubes is unsupported" \
    'exit 78' "$qubes_hook"
done
reject_pattern 'GPG policy never follows a mutable GitHub branch' \
  'drduh/config/(master|main)/gpg\.conf' "$ROOT/home/.chezmoidata.yaml"
require_pattern 'GPG policy bytes are verified before atomic installation' \
  'ba3201eb166e161ac00b3a17e8a6a3ff87b07ddcbeea7d79c8f071d98f034698' \
  "$ROOT/home/.chezmoidata.yaml" "$ROOT/home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl"

REPOSITORY_AUTHORITY_PATHS=(
  "$ROOT/home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl"
  "$ROOT/home/dot_config/system/usr/local/bin/executable_git-sync"
  "$ROOT/home/dot_local/bin/post-installx/executable_post-workstation.sh"
  "$ROOT/home/dot_local/bin/post-installx/executable_post-nvidia-toolkit.sh"
  "$ROOT/home/dot_local/bin/post-installx/executable_post-vscode.sh"
  "$ROOT/home/dot_local/bin/post-installx/executable_post-warp.sh"
  "$ROOT/home/dot_local/bin/post-installx/executable_post-wazuh.sh"
)
REPOSITORY_AUTHORITY_PATTERN='(curl|wget).*(githubcli-archive-keyring|download\.docker\.com/.*/gpg|packages\.microsoft\.com/keys|nvidia\.github\.io/.*/gpgkey|packages\.wazuh\.com/key|pkg\.cloudflareclient\.com/pubkey|proxmox-release.*\.gpg)|rpm --import[[:space:]]+https?://|gpgkey=https?://'
reject_pattern 'runtime paths never acquire package-manager trust directly from the network' \
  "$REPOSITORY_AUTHORITY_PATTERN" "${REPOSITORY_AUTHORITY_PATHS[@]}"

NETDATA_HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-netdata.sh"
if grep -q 'automated claiming and host tuning remain unsupported' "$NETDATA_HOOK" \
  && ! grep -qE 'get-secret|netdata-claim|sudo|systemctl|chown|/sys/kernel' "$NETDATA_HOOK"; then
  pass 'Netdata legacy claiming and host mutation fail closed'
else
  fail 'Netdata retains untyped claiming or host mutation authority'
fi

FIREWALL_HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-firewall.sh"
if grep -q 'native firewall convergence is unsupported until lockout-safe typed policy' "$FIREWALL_HOOK" \
  && ! grep -qE 'get-secret|infisical|SUDO_PASSWORD|sudo|apt-get|ufw|systemctl|socketfilterfw|/etc/' "$FIREWALL_HOOK"; then
  pass 'Firewall legacy privilege and lockout-prone mutation fail closed'
else
  fail 'Firewall retains untyped privilege or lockout-prone mutation authority'
fi

ZFS_PREP_HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-zfs-prep.sh"
if grep -q 'ZFS lifecycle convergence is unsupported until typed storage policy' "$ZFS_PREP_HOOK" \
  && ! grep -qE 'get-secret|SUDO_PASSWORD|sudo|apt-get|zfs[[:space:]]+(create|set|destroy)|zpool[[:space:]]+(scrub|clear|replace|detach)|systemctl|/sys/module|/etc/' "$ZFS_PREP_HOOK"; then
  pass 'ZFS legacy pool, kernel, policy, and scheduler mutation fail closed'
else
  fail 'ZFS prep retains untyped storage mutation authority'
fi

UNVERIFIED_ROOT_ARTIFACT_PATHS=(
  "$ROOT/home/.chezmoiscripts/universal/run_before_04-requirements.sh.tmpl"
  "$ROOT/home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl"
  "$ROOT/home/dot_local/bin/post-installx/executable_post-netdata.sh"
  "$ROOT/home/dot_local/bin/post-installx/executable_post-virtualbox.sh"
  "$ROOT/home/dot_local/bin/post-installx/executable_post-vmware.sh"
  "$ROOT/home/dot_local/bin/post-installx/executable_post-zsh-bootstrap.sh"
)
reject_pattern 'runtime paths never execute known unverified root artifact fallbacks' \
  'aur\.archlinux\.org/yay\.git|vmware-host-modules/archive|download\.virtualbox\.org/.+vbox-extpack|repo\.netdata\.cloud/.+\.deb|epel(-next)?-release-latest' \
  "${UNVERIFIED_ROOT_ARTIFACT_PATHS[@]}"

reject_pattern 'interactive shell startup never acquires or updates executable plugins from the network' \
  'git clone.*zinit|zinit[[:space:]]+(light|load|snippet)|OMZP::|atpull' \
  "$ROOT/home/dot_zshrc"
reject_pattern 'universal post-apply never installs mutable Docker plugins or ambient npm dependencies' \
  'docker plugin install|--grant-all-permissions|npm (i|install)([[:space:]]|$)' \
  "$ROOT/home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl"
reject_pattern 'Chezmoi data contains no dormant remote shell plugin installers' \
  'softwarePlugins:|releases/latest/download|helm plugin install|gh extension install|gcloud components install|steampipe plugin install|kubectl krew install' \
  "$ROOT/home/.chezmoidata.yaml"
reject_pattern 'logging never acquires executable renderers while handling output' \
  '(curl|wget).*(gum|glow)|brew install.*(gum|glow)|install(Gum|Glow)' \
  "$ROOT/home/dot_local/bin/executable_logg"
reject_pattern 'optional root host preparation never downloads node_exporter directly' \
  'node_exporter/releases/download|curl.*node_exporter|tar .*node_exporter' \
  "$ROOT/home/dot_config/system/usr/local/bin/executable_pve-sys-prep"
reject_pattern 'GNOME extension helper never installs unverified network archives' \
  '(wget|curl).*(download_url|shell-extension\.zip)|unzip.*download_url' \
  "$ROOT/home/dot_local/bin/executable_install-gnome-extensions.tmpl"
reject_pattern 'Volta configuration never installs moving runtime tags' \
  'volta install.*@(latest|main|master)' \
  "$ROOT/home/dot_local/bin/post-installx/executable_post-volta.sh"
reject_pattern 'control-plane tests never download an ambient Wrangler executable' \
  'npx([[:space:]]+--yes)?[[:space:]]+wrangler|pnpm dlx[[:space:]]+wrangler|bunx[[:space:]]+wrangler' \
  "$ROOT/scripts/test-control-plane.sh"
require_pattern 'Installx classifies mutable Go module references before execution' \
  'hasMutableGoReference' "$ROOT/home/dot_local/bin/executable_installx"

AUTHORITY_FIXTURE="$(mktemp)"
trap 'rm -f "$AUTHORITY_FIXTURE"' EXIT
printf '%s\n' 'curl https://example.invalid/key | gpg --dearmor' 'rpm --import https://example.invalid/key' > "$AUTHORITY_FIXTURE"
if grep -Eq -- '(curl|wget).*(gpg|key)|rpm --import[[:space:]]+https?://' "$AUTHORITY_FIXTURE"; then
  pass 'repository-authority detector catches planted network-fed trust roots'
else
  fail 'repository-authority detector is vacuous against planted bad input'
fi

printf 'runtime-code-authority: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
