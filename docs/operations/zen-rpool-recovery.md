# Zen rpool recovery status

Observed 2026-11-04 through the repository-authorized `zen.megabyte.space` SSH target. Raw evidence is held in a mode-0700 temporary evidence directory and is not committed because it contains device and host metadata.

## Current finding

- `bpool`: online, zero known data errors.
- `rpool`: online, but the completed scrub reports two permanent data errors and repaired `0B`. `zpool status -v` does not resolve them to file paths.
- Topology: one SATA SSD contains the EFI system partition, `bpool`, swap, and `rpool`; there is no pool or boot-device redundancy.
- Hardware: SMART overall health says passed, but the device records one reallocated sector, ten uncorrectable errors, and ten historical UNC ATA errors. A passing summary does not erase those counters.
- Encryption: ZFS datasets report encryption off; no independently encrypted replica or backup was proven.
- Recovery points: Sanoid has current same-device snapshots and monthly scrub timers. These snapshots do not survive loss of the only SSD.
- Restic is installed, but no active off-host Restic timer/unit or usable repository was proven.
- Boot: UEFI loads Ubuntu shim/GRUB from the sole SSD's EFI partition. Replacing ZFS data alone would not restore boot redundancy.

## Decision

Do not clear the errors, force-import, detach, replace, destroy snapshots, force a receive, or add avoidable scan pressure. Software cannot repair the recorded media fault and the pool has no valid redundant copy from which ZFS can repair the corrupt blocks.

The repair is blocked on all of:

1. A verified independent recovery source for Zen's authoritative data.
2. Identification of the data represented by the two unresolvable permanent errors, or an application-level validation/reinstall plan where they are metadata/unmapped objects.
3. A replacement SSD decision and maintenance window.
4. Immediate revalidation of serial, WWN, partitions, pool GUIDs, and UEFI layout before any device mutation.

## Exact maintenance procedure once prerequisites exist

1. Stop new stateful placement and capture fresh read-only assessment evidence.
2. Create and verify an encrypted independent backup; restore representative data into an isolated target.
3. Record installed packages, boot entries, partition GUIDs, pool/dataset properties, mountpoints, and required application-native dumps.
4. Power down and replace the identified SSD. Because the existing pool is a single-device root pool, use the Ubuntu/OpenZFS root recovery procedure appropriate to the installed release; recreate EFI, `bpool`, swap, and encrypted `rpool` deliberately rather than pretending an online mirror replacement is available.
5. Restore through the proven recovery path, reinstall shim/GRUB to the new EFI partition, and verify boot without the old SSD.
6. Verify application behavior and content, then run a scrub. Report the pool pending until the scrub completes with zero errors.
7. Retain the old device unchanged until recovery is accepted; then handle it under the approved media-disposal process.

Use `scripts/fleet-storage-assess.sh --host zen.megabyte.space --output <new-private-directory>` for repeatable read-only evidence. It intentionally has no repair mode.
