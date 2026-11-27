# Tasks

- [x] Verify the existing archive receipt, archive bytes, and public Node member.
- [x] Adopt the exact Node member and record provenance.
- [x] Verify equivalent effective compiler config and the Control Plane tooling checks.

## Verification

- The retained Testing 1.0.2 archive matched its provenance receipt and the installed base profile. Its manifest exported the Node profile, and the extracted JSON matched the recorded SHA-256.
- With Node 24.22.2 and locked offline installs, the Aid Core build and normal Control Plane tooling typecheck passed. The same TypeScript 5.8.3 compiler produced byte-identical `--showConfig` output before and after the change, including all 11 tooling inputs.
- Control Plane typed tooling lint and strict OpenSpec validation passed.
