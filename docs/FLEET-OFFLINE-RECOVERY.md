# Fleet offline recovery catalog

The design uses a dedicated age recipient for the encrypted catalog.
The matching private identity is in a separate passphrase-encrypted age
file. The authorized controller holds the logical `encryption-password`
through its existing protected `get-secret` authority. Ordinary hosts
receive neither that password nor the private identity.

## Catalog and custody

A version 1 catalog is a JSON object with `version: 1` and an
`entries` array. Each entry has a unique combination of `kind`,
`target`, and `generation`, plus the native recovery material encoded
in `material`. Record the encoding, native fingerprint where available,
and the backup generations it covers. Include key material and the
minimum bootstrap access needed by the covered services. Preserve
historical entries until their recovery points expire or their replacement
has passed a restore. Use the service's native keys and encryption
formats.

Hold the two encrypted files outside the primary failure domain.
Record their ciphertext hashes, catalog version, and custody in an
independently authenticated recovery record. The hashes provide a
comparison against that record. They should not be inferred from a
catalog obtained from an untrusted location. Production plaintext
belongs only in protected volatile storage on the trusted controller
or an isolated recovery machine. Keep secret values out of terminal
output, scripts, command arguments and repository history.

## Native age workflow

Use age from a verified source. Run inside a private directory on
approved volatile storage. Supply the authorized password only at the
native age TTY prompt.

```sh
set -e
set -o pipefail
umask 077
age-keygen 2>recipient.log | age -p -o identity.age
sed -n 's/^Public key: //p' recipient.log > recipient.txt
test -s recipient.txt
age -R recipient.txt -o catalog.age catalog.json
```

The pipeline encrypts the private key without a plaintext key file.
Keep the recipient available for encrypting future catalog revisions.
Use fresh output paths for a replacement so the last verified package
remains available while validating the new copy. The age manual
documents passphrase-encrypted identity files and their prompt.
[age manual](https://github.com/FiloSottile/age/blob/v1.3.1/doc/age.1.ronn)

In an isolated recovery environment, verify the ciphertext against the
approved record, then decrypt to protected volatile storage:

```sh
umask 077
age -d -i identity.age -o recovered-catalog.json catalog.age
```

Use the native client for each covered key and restore a known artifact
against its expected digest. Confirm retained historical entries work
as well. Run a wrong-password and unrelated-identity denial fixture
using synthetic data. Remove temporary plaintext before reconnecting
the recovery environment. Revoke an exposed package passphrase only
after the authorized successor decrypts and covers the retained keys.

## Verification status

On November 27, 2026, age 1.3.1 on the trusted macOS controller
encrypted and recovered a synthetic version 1 catalog byte for byte.
The protected identity also decrypted the catalog with process network
access denied. A wrong password and an unrelated age identity exited
with failure and produced no plaintext. The temporary artifacts were
removed. No production key or password was used.

The same controller has a protected encrypted historical PBS key file.
Its installed `get-secret` did not resolve either case of the intended
logical password reference during verification. Production package
creation, independent custody, rotation of the historical passphrase,
and native restore tests for each covered historical key remain open.
