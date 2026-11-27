## Why

Offline bundle verification sits outside the Installer Engine strict source gate and relies on unchecked lookups for verified bytes.

## What Changes

Enable the ordinary strict gate and check content lookups while preserving signed catalog and signature-file admission.
