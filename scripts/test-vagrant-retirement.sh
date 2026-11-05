#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

for retired_path in \
  Vagrantfile \
  home/dot_local/share/vagrant.d/Vagrantfile \
  home/dot_config/vagrant/aliases \
  .config/taskfiles/vagrant/Taskfile.yml \
  .config/taskfiles/vagrant/Taskfile-qubes.yml \
  home/dot_local/share/ansible/.config/molecule/vagrant.create.yml \
  home/dot_local/share/ansible/.config/molecule/vagrant.destroy.yml \
  home/.chezmoitemplates/secrets/VAGRANT_CLOUD_TOKEN \
  home/.chezmoitemplates/secrets-workstation/VAGRANT_CLOUD_TOKEN; do
  [[ ! -e "$retired_path" ]] || fail "retired path still exists: $retired_path"
done

python3 - <<'PY'
from pathlib import Path
import yaml

catalog = yaml.safe_load(Path("software.yml").read_text())
software = catalog["softwarePackages"]
for retired in ("vagrant", "vagrant-manager", "vagrant-vmware-utility"):
    if retired in software:
        raise SystemExit(f"retired catalog entry remains: {retired}")
for preserved in ("virtualbox", "vmware"):
    if preserved not in software:
        raise SystemExit(f"non-Vagrant virtualization entry was removed: {preserved}")
PY

active_paths=(
  software.yml
  .config/Brewfile
  .config/variables.json
  .config/docs/variables.json
  home/dot_config
  home/dot_local/bin
  home/dot_local/share/ansible
  docs/advanced
  docs/cli
  docs/customization
  docs/features
)
if rg -n -i \
  'VAGRANT_CLOUD_TOKEN|VAGRANT_HOME|vagrant-manager|vagrant-vmware|molecule-vagrant|python-vagrant|task[^[:cntrl:]]*vagrant|vagrant (init|up|validate)|vagrantup\.com' \
  "${active_paths[@]}"; then
  fail "active Vagrant integration remains"
fi

[[ -f home/dot_local/bin/post-installx/executable_post-vmware.sh ]] || fail "VMware support was removed"
[[ -f home/dot_local/share/ansible/environments/prod/group_vars/qubes/roles.yml ]] || fail "Qubes support was removed"
rg -q 'roles/virtualization/kvm' home/dot_local/share/ansible/environments/prod/group_vars/qubes/roles.yml || fail "KVM/QEMU support was removed"
rg -q '^  virtualbox:' software.yml || fail "VirtualBox support was removed"
rg -q '^  vmware:' software.yml || fail "VMware support was removed"

# Keep explicit desired-state removals so existing installations clean up retired artifacts.
rg -q '\.vagrant\.d/' home/.chezmoiremove || fail "existing-host Vagrant cleanup marker was removed"

printf 'PASS: Vagrant integrations retired; VirtualBox, VMware, QEMU, and Qubes support preserved\n'
