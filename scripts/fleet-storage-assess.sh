#!/usr/bin/env bash
# Capture private, read-only storage evidence from one explicitly named host.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: fleet-storage-assess.sh --host HOSTNAME --output NEW_DIRECTORY

Creates a private observed-state evidence directory. The destination must not
already exist. This command performs assessment only; it has no repair mode.
EOF
}

host=''
output=''
while (($#)); do
  case "$1" in
    --host)
      (($# >= 2)) || { echo 'error: --host requires a value' >&2; exit 2; }
      host=$2
      shift 2
      ;;
    --output)
      (($# >= 2)) || { echo 'error: --output requires a value' >&2; exit 2; }
      output=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'error: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$host" ]] || { echo 'error: --host is required' >&2; exit 2; }
[[ -n "$output" ]] || { echo 'error: --output is required' >&2; exit 2; }
[[ "$output" != -* ]] || { echo 'error: --output may not begin with a dash' >&2; exit 2; }

# Accept DNS host names and IPv4 literals, never shell syntax, options, users,
# ports, or whitespace. SSH receives this validated value as one argument.
if ((${#host} > 253)) ||
   [[ ! "$host" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] ||
   [[ "$host" == *..* ]] || [[ "$host" == *.-* ]] || [[ "$host" == *-. ]]; then
  echo 'error: --host must be a plain DNS hostname or IPv4 address' >&2
  exit 2
fi

command -v ssh >/dev/null 2>&1 || { echo 'error: ssh is required' >&2; exit 1; }

# mkdir without -p is the non-overwrite gate. A restrictive umask protects all
# evidence even if a probe is interrupted before final permissions are applied.
umask 077
if ! mkdir -m 700 "$output" 2>/dev/null; then
  printf 'error: output must be a new creatable directory: %s\n' "$output" >&2
  exit 1
fi
chmod 700 "$output"

status_file="$output/status.tsv"
: >"$status_file"
chmod 600 "$status_file"
printf 'probe\tstatus\texit_code\n' >>"$status_file"

cat >"$output/README.txt" <<EOF
This directory contains observed evidence, not desired state.

Target: $host
Captured as private read-only diagnostic evidence. A probe marked unavailable
means its required command was absent on the target. A failed probe must be
investigated; it is not evidence that the corresponding subsystem is healthy.
No repair or storage mutation is performed by this collector.
EOF
chmod 600 "$output/README.txt"

record_probe() {
  local name=$1
  local remote=$2
  local evidence="$output/$name.txt"
  local error="$output/$name.stderr.txt"
  local rc=0

  if ssh -o BatchMode=yes -o ConnectTimeout=10 -- "$host" "$remote" >"$evidence" 2>"$error"; then
    printf '%s\tok\t0\n' "$name" >>"$status_file"
  else
    rc=$?
    printf '%s\tfailed\t%d\n' "$name" "$rc" >>"$status_file"
  fi
  chmod 600 "$evidence" "$error"
}

# Each remote snippet is a constant. Optional tools report an explicit marker
# rather than aborting the remaining assessment.
record_probe identity \
  'printf "hostname\t"; hostname -f 2>/dev/null || hostname; printf "time_utc\t"; date -u +%Y-%m-%dT%H:%M:%SZ; printf "machine_id_hash\t"; if test -r /etc/machine-id && command -v sha256sum >/dev/null 2>&1; then sha256sum /etc/machine-id | cut -d" " -f1; else printf "unavailable\n"; fi'
record_probe os_kernel \
  'uname -a; if test -r /etc/os-release; then printf "\n--- os-release ---\n"; sed -n "1,80p" /etc/os-release; fi'
record_probe filesystems_mounts \
  'if command -v findmnt >/dev/null 2>&1; then findmnt --real --output SOURCE,TARGET,FSTYPE,OPTIONS; else printf "unavailable: findmnt\n"; fi; printf "\n--- usage ---\n"; df -PT 2>&1'
record_probe block_devices \
  'if command -v lsblk >/dev/null 2>&1; then lsblk -e 7 -o NAME,PATH,TYPE,SIZE,FSTYPE,FSVER,LABEL,UUID,PARTUUID,MODEL,SERIAL,WWN,ROTA,TRAN,MOUNTPOINTS; else printf "unavailable: lsblk\n"; fi; printf "\n--- blkid ---\n"; if command -v blkid >/dev/null 2>&1; then blkid; else printf "unavailable: blkid\n"; fi'
record_probe pool_status \
  'if command -v zpool >/dev/null 2>&1; then zpool status -P -v; else printf "unavailable: zpool\n"; fi'
record_probe pool_inventory \
  'if command -v zpool >/dev/null 2>&1; then zpool list -H -p -o name,size,alloc,free,frag,cap,health,guid; printf "\n--- properties ---\n"; zpool get -H -p all; else printf "unavailable: zpool\n"; fi'
record_probe pool_history \
  'if command -v zpool >/dev/null 2>&1; then zpool history -il; else printf "unavailable: zpool\n"; fi'
record_probe datasets \
  'if command -v zfs >/dev/null 2>&1; then zfs list -H -p -t filesystem,volume,snapshot -o name,type,used,available,referenced,mountpoint,creation; else printf "unavailable: zfs\n"; fi'
record_probe encryption \
  'if command -v zfs >/dev/null 2>&1; then zfs list -H -o name -t filesystem,volume | while IFS= read -r dataset; do zfs get -H -p encryption,encryptionroot,keyformat,keylocation,keystatus,mounted,mountpoint "$dataset"; done; else printf "unavailable: zfs\n"; fi'
record_probe smart \
  'if command -v smartctl >/dev/null 2>&1; then smartctl --scan-open 2>&1; for d in /dev/disk/by-id/ata-* /dev/disk/by-id/scsi-*; do test -e "$d" || continue; printf "\n--- %s ---\n" "$d"; smartctl -H -A -i "$d" 2>&1; done; else printf "unavailable: smartctl\n"; fi'
record_probe nvme \
  'if command -v nvme >/dev/null 2>&1; then nvme list 2>&1; for d in /dev/nvme[0-9]; do test -e "$d" || continue; printf "\n--- %s ---\n" "$d"; nvme smart-log "$d" 2>&1; nvme error-log "$d" 2>&1; done; else printf "unavailable: nvme\n"; fi'
record_probe kernel_io \
  'if command -v journalctl >/dev/null 2>&1; then journalctl -k --no-pager -n 3000 2>&1 | grep -Ei "zfs|nvme|ata|scsi|blk|I/O error|medium error|reset|timeout|corrupt|fault" || true; elif command -v dmesg >/dev/null 2>&1; then dmesg 2>&1 | grep -Ei "zfs|nvme|ata|scsi|blk|I/O error|medium error|reset|timeout|corrupt|fault" || true; else printf "unavailable: journalctl and dmesg\n"; fi'
record_probe boot \
  'printf "%s\n" "--- firmware ---"; if test -d /sys/firmware/efi; then printf "uefi\n"; else printf "legacy-or-unknown\n"; fi; printf "%s\n" "--- cmdline ---"; if test -r /proc/cmdline; then cat /proc/cmdline; fi; printf "%s\n" "--- bootctl ---"; if command -v bootctl >/dev/null 2>&1; then bootctl status 2>&1; else printf "unavailable: bootctl\n"; fi; printf "%s\n" "--- efibootmgr ---"; if command -v efibootmgr >/dev/null 2>&1; then efibootmgr -v 2>&1; else printf "unavailable: efibootmgr\n"; fi'
record_probe protection \
  'for c in sanoid syncoid restic proxmox-backup-client; do if command -v "$c" >/dev/null 2>&1; then printf "%s\t" "$c"; "$c" --version 2>&1 | head -n 1; else printf "%s\tunavailable\n" "$c"; fi; done; if command -v systemctl >/dev/null 2>&1; then printf "\n--- relevant timers ---\n"; systemctl list-timers --all --no-pager 2>&1 | grep -Ei "sanoid|zfs|scrub|restic|backup|syncoid" || true; fi'

printf 'Evidence captured in %s\n' "$output"
