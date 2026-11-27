## Why

The Installer Engine's device enrollment, credential storage, and authorization transport bypass the ordinary strict source lint gate.

## What Changes

Enable strict lint for the three device authorization modules. Keep request binding, protected file permissions, HTTP status handling, and stored schema semantics compatible.
