# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project uses semantic versioning intent.

## [Unreleased]

- No changes yet.

## [0.1.3] - 2026-02-21

Release tracking: [PR #66].

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
- Aligned CI matrix to supported Python versions (`3.11`, `3.12`).
- Enforced a conservative baseline coverage floor while retaining non-regression checks.

[0.1.3]: https://github.com/Doogie201/NextLevelApex/releases/tag/v0.1.3
[PR #66]: https://github.com/Doogie201/NextLevelApex/pull/66
