# Tasks

- [x] Measure the strict lint baseline for the Node tooling project.
- [x] Narrow catalog, offline publication, and release CLI inputs and verify with local fixtures.
- [ ] Retire remaining tooling lint findings with the JavaScript entry-point guards intact.
- [ ] Enable the shared tooling lint gate after the selected project passes without findings.

The first pass reduced strict findings from 106 to 27 across nine scripts. Seven scripts now pass. The catalog generator produced identical bytes for 1,064 entries. The remaining findings are in the two release publication libraries.
