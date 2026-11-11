# Release root rotation and emergency revocation

Release root keys are offline authorities. Generate and operate them only in an approved isolated
environment; repository tooling consumes public keys and signatures and must never receive private
key material. A rotation advances exactly one root version and is accepted only when the new root is
signed by both the old threshold and its own threshold. It retains an old-threshold overlap while
introducing at least one new key, allowing clients to cross the trust transition safely.

1. Export and independently compare the current public root digest.
2. Generate the replacement key offline and keep private material outside Git, CI, logs, and targets.
3. Construct the next root with the required old-key overlap and bounded expiry.
4. Collect the old threshold and new threshold signatures in separate operator sessions.
5. Run `verify-release-key-ceremony.mjs` against disposable copies before publication.
6. Publish the immutable root, then update timestamp/snapshot metadata without replacing history.
7. Retain the prior public root and recovery instructions for historical verification.

For emergency revocation, publish signed `revocation` metadata naming known key IDs, an effective
time, and a meaningful reason. Revoke online credentials and suspend dependent promotion separately;
metadata publication is not credential revocation. Never delete historical public keys required to
verify retained releases. Validate a ceremony with:

```bash
node scripts/verify-release-key-ceremony.mjs \
  --current-root current-root.json --next-root next-root.json \
  --revocation revocation.json --now 2028-02-01T00:00:00Z
```
