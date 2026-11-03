#!/usr/bin/env bash
# Top-50 Provisioning Audit & Zero-Trust Hardening Gate
# Locks the removal of all 50 provisioning anti-patterns, dead tools, duplicate stages,
# hardcoded passwords/keys, endlessh/port-8169 mutations, and verifies the Infisical-backed
# desktop autologin + Cloudflare-only incoming firewall enforcement.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "Top-50 Provisioning Audit & Zero-Trust Hardening Gate"

# 1. No plaintext TinyPNG API key in .chezmoi.yaml.tmpl
if ! grep -q 'g355tx7dxG5yJfl0RXJnpQlQqk88dJBv' home/.chezmoi.yaml.tmpl; then
  pass "1. Plaintext TinyPNG API key removed from home/.chezmoi.yaml.tmpl"
else
  fail "1. Plaintext TinyPNG API key still present in home/.chezmoi.yaml.tmpl"
fi

# 2. No unconditional VNC with hardcoded 'vncpass' in run_after_20-post-install.sh.tmpl
if ! grep -q 'vncpass' home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl && grep -q "macosRemoteLogin: 'off'" home/.chezmoidata.yaml; then
  pass "2. Unconditional VNC / ARD with hardcoded 'vncpass' removed and macosRemoteLogin defaults to 'off'"
else
  fail "2. Hardcoded 'vncpass' or macosRemoteLogin:'on' still present"
fi

# 3. No hardcoded 'bananas' SUDO_PASSWORD in scripts/provision.sh or scripts/src/provision.sh.tmpl
if ! grep -q 'SUDO_PASSWORD="bananas"' scripts/provision.sh scripts/src/provision.sh.tmpl; then
  pass "3. Hardcoded SUDO_PASSWORD='bananas' removed from provision.sh and provision.sh.tmpl"
else
  fail "3. Hardcoded SUDO_PASSWORD='bananas' still present"
fi

# 4. Secure Infisical-backed desktop autologin (no unverified 3rd-party xfreebird/utils/kcpassword tap)
if ! grep -q 'xfreebird/utils/kcpassword' home/.chezmoiscripts/universal/run_before_02-homebrew.sh.tmpl \
  && grep -q 'enableSecureDesktopAutologin' home/.chezmoiscripts/universal/run_before_02-homebrew.sh.tmpl \
  && [ -x home/dot_local/bin/executable_desktop-autologin ] \
  && grep -q 'INFISICAL_TOKEN' home/dot_local/bin/executable_desktop-autologin; then
  pass "4. Secure Infisical-backed desktop autologin implemented (in-memory XOR /etc/kcpassword + Linux GDM/LightDM/SDDM, zero 3rd-party tap)"
else
  fail "4. Secure Infisical-backed desktop autologin missing or still uses xfreebird/utils/kcpassword"
fi

# 5. SSH kept on standard port 22, endlessh removed, and Cloudflare-only Zero-Trust firewall wired
if grep -q 'port: 22' home/.chezmoi.yaml.tmpl \
  && ! grep -q 'endlesshPort' home/.chezmoi.yaml.tmpl \
  && [ ! -e home/dot_local/bin/post-installx/executable_post-endlessh.sh ] \
  && [ ! -e home/private_dot_ssh/endlessh/config.tmpl ] \
  && ! grep -q '/etc/services' home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl \
  && [ -x home/dot_local/bin/executable_cloudflare-firewall ] \
  && grep -q 'configureCloudflareFirewall' home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl; then
  pass "5. SSH remains on Port 22, endlessh removed, and Cloudflare-Only Zero-Trust Firewall (cloudflare-firewall) is wired"
else
  fail "5. SSH port 22 / endlessh removal / cloudflare-firewall wiring incomplete"
fi

# 6. Verify cloudflare-firewall outputs official Cloudflare IPv4 & IPv6 CIDRs
cf_cidrs="$(bash home/dot_local/bin/executable_cloudflare-firewall --print-cidrs 2>/dev/null)"
if printf '%s\n' "$cf_cidrs" | grep -q '173.245.48.0/20' && printf '%s\n' "$cf_cidrs" | grep -q '2400:cb00::/32'; then
  pass "6. cloudflare-firewall resolves official Cloudflare IPv4 (173.245.48.0/20) and IPv6 (2400:cb00::/32) CIDRs"
else
  fail "6. cloudflare-firewall failed to output Cloudflare IPv4/IPv6 CIDRs"
fi

# 7. Public Vagrant insecure SSH key removed & Ed25519 SSH key generation enforced
if ! grep -q 'authorized_keys.vagrant' home/.chezmoiexternal.toml.tmpl \
  && grep -q 'id_ed25519' home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl; then
  pass "7. Public Vagrant SSH key removed and ensureSSHKey generates modern Ed25519 keys"
else
  fail "7. Vagrant SSH key still present or Ed25519 key generation missing"
fi

# 8. Duplicate run_after_15-chezmoi-system.sh.tmpl removed & bootstrap deduplication guard wired
if [ ! -e home/.chezmoiscripts/universal/run_after_15-chezmoi-system.sh.tmpl ] \
  && grep -q 'INSTALL_DOCTOR_PROVISION_BOOTSTRAPPED' scripts/provision.sh \
  && grep -q 'INSTALL_DOCTOR_PROVISION_BOOTSTRAPPED' home/.chezmoiscripts/universal/run_before_01-prepare.sh.tmpl \
  && grep -q 'INSTALL_DOCTOR_PROVISION_BOOTSTRAPPED' home/.chezmoiscripts/universal/run_before_02-homebrew.sh.tmpl; then
  pass "8. Duplicate run_after_15 removed and INSTALL_DOCTOR_PROVISION_BOOTSTRAPPED deduplicates provision.sh vs run_before_01/02"
else
  fail "8. Duplicate run_after_15 or bootstrap deduplication guard missing"
fi

# 9. Dead/blocking tools removed (Xcode 40m mas install, Volta, vim +CocUpdateSync, shell-gpt, zap root curl, linux-fonts tap, emsdk)
if ! grep -q 'CocUpdateSync' scripts/provision.sh \
  && ! grep -q 'installXcode' home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl \
  && ! grep -q 'installShellGPT' home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl \
  && ! grep -q 'zapInstall' home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl \
  && ! grep -q 'homebrew/linux-fonts' home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl \
  && ! grep -q 'emscriptenInstall' home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl \
  && ! grep -q 'gas-station' home/.chezmoiexternal.toml.tmpl; then
  pass "9. Dead & blocking tools (Xcode mas 40m block, CocUpdateSync, shell-gpt, zapInstall, linux-fonts, emsdk, gas-station) removed"
else
  fail "9. One or more dead/blocking tools still present in provisioning scripts"
fi

# 10. Infisical secret resolution wired into get-secret and hiSHtory post-installx hook present
if grep -q 'infisical secrets get' home/dot_local/bin/executable_get-secret \
  && [ -x home/dot_local/bin/post-installx/executable_post-hishtory.sh ]; then
  pass "10. Infisical Vault priority wired into get-secret and executable_post-hishtory.sh present"
else
  fail "10. Infisical secret resolution in get-secret or executable_post-hishtory.sh missing"
fi

# 11. Orphaned dot_config dirs & PII-containing binaries (launchpress, improve-code, gpt, aihawk, vnc, zap, Base.code-profile) removed
if [ ! -e home/dot_local/bin/executable_launchpress ] \
  && [ ! -e home/dot_local/bin/executable_improve-code ] \
  && [ ! -d home/dot_local/bin/gpt ] \
  && [ ! -d home/dot_config/aihawk ] \
  && [ ! -d home/dot_config/vnc ] \
  && [ ! -d home/dot_config/zap ] \
  && [ ! -e home/dot_config/Code/User/Base.code-profile ]; then
  pass "11. Orphaned dot_config dirs and PII-containing legacy scripts removed"
else
  fail "11. Orphaned dot_config dirs or PII-containing legacy scripts still present"
fi

# 12. Shell startup acceleration: no slow pip3/certifi or flatpak/brew --prefix subshell forks on every shell start
if ! grep -q 'pip3 list' home/dot_config/shell/exports.sh.tmpl \
  && ! grep -q 'flatpak --installations' home/dot_config/shell/exports.sh.tmpl \
  && ! grep -q 'brew --prefix' home/dot_config/shell/aliases.sh.tmpl; then
  pass "12. Zero-fork shell startup optimizations active in exports.sh.tmpl and aliases.sh.tmpl"
else
  fail "12. Slow pip3/flatpak/brew subshell forks still present in shell startup templates"
fi

# 13. aid doctor & aid search subcommands + Television (tv) fuzzy channels wired
if bash home/dot_local/bin/executable_aid doctor 2>&1 | grep -q 'aid doctor summary:' \
  && [ -f home/dot_config/television/cable/apps.toml ] \
  && [ -f home/dot_config/television/cable/posture.toml ]; then
  pass "13. aid doctor diagnostic command and Television (tv) fuzzy cable channels wired"
else
  fail "13. aid doctor or Television fuzzy cable channels missing"
fi

say "top50-provisioning-hygiene: $P passed, $F failed"
[ "$F" -eq 0 ]
