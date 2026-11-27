# Design

Treat parsed catalog entries as unknown. Validate the top-level array, use object identity for the merge comparison, and narrow the expected tree entry only where read.
