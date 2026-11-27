## Why

The Windows native operation planner and fixture evaluator are excluded from strict source lint and use non-null assertions for action-dependent digest fields.

## What Changes

Check the digest before applying write, set, or materialize fixture state. Enable standard strict lint for the module.
