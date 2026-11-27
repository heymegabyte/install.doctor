# Design

Keep the shared strict profile and existing test project. Remove the temporary exact-path list after all dependent fixture changes pass. Run the unmodified package test command and compare ESLint's checked path set to the tracked Control Plane fixtures, then verify the scoped GitHub Linux lint step.
