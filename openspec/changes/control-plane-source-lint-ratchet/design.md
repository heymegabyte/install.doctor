# Design

Use the Control Plane production `tsconfig.json` for the existing shared typed ESLint factory. The normal package verification and Linux structural checks should invoke a source lint script after generating Wrangler runtime types. Allow only measured exact-path exceptions. Keep runtime implementation outside this gate change.

The source remediation baseline has 906 diagnostics in `index.ts` and 97 across 19 other modules. Independent batches are release reads and bootstrap (37), broker authorization (35), broker authority and storage (15), and authentication, environment, and HTTP (10). Remove each exact exception after its owner verifies the file.
