## Why

The native dpkg ownership fence is excluded from the standard Installer Engine strict source gate. The companion quiescence observer is also excluded.

## What Changes

Enable strict lint for the fence and quiescence observer, modernize equivalent schema constructors, and type protected JSON and asynchronous errors at their boundaries.
