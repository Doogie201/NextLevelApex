# Security Policy

## Reporting a Vulnerability

If you discover a vulnerability in NextLevelApex, report it privately:

- Preferred: GitHub Security Advisory (private report)
- Fallback: email `doogie201@gmail.com` with subject `NextLevelApex Security Report`

Please include:

- Affected version/commit
- Reproduction steps
- Impact assessment
- Suggested mitigation (if available)

Do not disclose publicly until a fix is available.

## Response Targets

- Acknowledgement: within 72 hours
- Triage decision: within 7 days
- Fix timeline: depends on severity and reproducibility

## Scope and Threat Model Highlights

Security-critical controls in this repository include:

- Task import gating to approved modules only
- Remediation execution restricted to allowlisted command vectors
- No `shell=True` command execution paths
- `install-sudoers` strict validation and deterministic rule rendering
- Least-privilege sudoers run-as (`root` only)
- Fail-closed sudoers include-dir verification
- Atomic writes for state and report outputs

Historical hardening notes are tracked in `SECURITY_NOTES.md`.
