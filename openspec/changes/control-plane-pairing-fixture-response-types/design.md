# Design

Use the canonical device authorization request schema inside a test envelope. Use local projections for pairing and credential fields consumed by the tests, retaining additional properties so existing assertions can inspect them. Keep production endpoints outside this change.
