## 1. Separate Cua authority

- [x] 1.1 Remove implicit agent and skill registration from the native desktop hook and document ownership.
- [x] 1.2 Verify repeated desktop hook execution preserves agent configuration and that a headless run does not activate the driver.
- [ ] 1.3 Verify a managed desktop deployment respects existing agent configuration and preserves driver operation.

The revised Legion hook passed two fixture runs and a headless case on the enrolled host. The real user daemon remained active with the same PID across hook deployment. A real activation after host maintenance and a macOS canary remain pending. See Legion's November 28 delivery checkpoint.
