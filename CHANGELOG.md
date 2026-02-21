# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning intent.

## [Unreleased]

### Security
- Hardened `install-sudoers` behavior:
  - macOS-only gate
  - strict interface and username validation
  - deterministic sudoers argument escaping
  - least-privilege run-as target (`root`)
  - fail-closed include-dir checks with non-interactive sudo fallback
  - timeout guards for sudoers read/validation subprocesses
- Removed YAML state export path from CLI (`json` and `csv` only).
- Added repository guard tests for disallowed `shell=True` usage.

### Reliability
- Added/expanded atomic write tests and state permission checks (`0600`).
- Kept state/report writes atomic via temp-file + fsync + replace pattern.

### Documentation
- Rebuilt `README.md`, `CONTRIBUTING.md`, and `SECURITY.md` for contributor and operator clarity.
- Added this changelog.

### CI
- Corrected multiline pytest coverage invocation in GitHub Actions CI.
