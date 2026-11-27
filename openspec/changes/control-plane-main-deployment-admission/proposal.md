# Admit reviewed Control Plane production releases from main

Main is the integration branch for Control Plane source. At `34252ef8`, the production workflow, GitHub protected environment, and both deployment identities admit only `refs/heads/master`. The two branches had diverged by 252 and 69 commits at the audit snapshot. A manual run today cannot ship the exact verified main revision.

This proposal covers Control Plane admission only. The cutover requires access to the existing GitHub environment and Infisical identity settings. The outcome would let the existing protected release path build, approve, deploy, and probe the exact main revision without widening the credential roles.
