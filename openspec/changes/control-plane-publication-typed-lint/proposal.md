# Strengthen Control Plane publication tooling types

The shared typed lint audit reported 106 findings across nine Node tooling files. Several findings identify JSON values and subprocess boundaries whose TypeScript types are too broad to substantiate the release checks.

Update the release, catalog, and offline-bundle scripts in small independently verified changes. Keep live publication, storage policy, signature verification, and CLI entry points outside the migration scope.
