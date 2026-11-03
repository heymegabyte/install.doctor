# Tasks

- [x] 1. Build the tracked-file classifier, schema, coverage ledger generator, and completeness test.
- [x] 2. Compile and review repository slices with Repomix/OpenCode and record the hydration manifest.
- [x] 3. Run baseline syntax, schema, dependency, secret, reference, asset, documentation, and test gates.
- [x] 4. Implement and test high-confidence bootstrap, home automation, and fleet-provisioning improvements.
- [x] 5. Implement and test high-confidence aid-core and control-plane improvements.
- [x] 6. Implement and test high-confidence site, documentation, accessibility, and content improvements that do not require visual redesign.
- [x] 7. Implement and test high-confidence repository hygiene, workflow, dependency, generated-file, and asset improvements.
- [x] 8. Run two complete no-new-winner convergence passes and produce the final evidence ledger.
- [ ] 9. Run full verification, sync specifications, and archive the completed change.

## Verification evidence

- Tracked-file ledger schema v2: 2,923/2,923 paths carry a disposition, reason, and evidence; zero review gaps.
- Repository suite, pass 1: 61 suites; one expected platform skip; a transient live-header check passed on immediate isolated rerun.
- Repository suite, pass 2: 61 suites; 768 assertions passed; zero failures; one expected Linux-on-macOS skip.
- `packages/aid-core`: TypeScript strict build and 69/69 tests passed.
- Final integration suite: 66 suites; 818 assertions passed; zero failures; one expected Linux-on-macOS skip.
- Additional convergence pass 1 (correctness/security): completed the pipx-to-uv execution, inventory, update, injection, and control-plane command migration; added replacement detail metadata and regression coverage.
- Additional convergence pass 2 (performance/maintainability): fixed eager Flatpak task starts, process-global working-directory races, temporary Brewfile leaks, and swallowed Brew/cask failures; added scheduler regression coverage.
- Additional convergence pass 3 (product/documentation/removal hygiene): corrected 22 stale canonical GitHub links and remaining scoped spelling defects while retaining the intentional GitLab mirror.
- Post-pass integration suite: 67 suites; 826 assertions passed; zero failures; one expected Linux-on-macOS skip.
- OpenCode/Repomix hydration was attempted by bounded repository slice. Oversized slices failed closed at the context ceiling and several gateway responses failed schema parsing; no raw pack or unvalidated child output was injected. Local schema-aware validators and the exhaustive tracked-file ledger supplied coverage for those slices.
- No deployment, CDN purge, live service mutation, or OpenSpec archive was performed.
