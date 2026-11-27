# Design

Use the TypeScript AST to match ignored call expressions bound to imports from node:test. Add void only to registration statements outside test callbacks. Run the existing compiler and Control Plane suite, then compare the typed lint baseline.
