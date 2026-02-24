# Sprint S08 — Dev Setup Guardrails

| Field | Value |
|-------|-------|
| Sprint ID | `S08` |
| Name | Dev setup guardrails |
| Status | done |
| Category | docs |
| Milestone | M1 |
| Baseline SHA | `6ba186b9cbe30709be48751cd33526f17670e41f` |
| Branch | `sprint/S08-dev-setup-guardrails` |
| PR | [#115](https://github.com/Doogie201/NextLevelApex/pull/115) |

## Objective

Add worktree/Poetry setup documentation to README and create a one-command `scripts/dev-setup.sh` script. No runtime behavior changes.

## Acceptance Tests

- [x] AT-S08-01 `scripts/dev-setup.sh` exists, is executable, and exits 0 on a fresh worktree.
- [x] AT-S08-02 `scripts/dev-setup.sh` is idempotent (second run also exits 0).
- [x] AT-S08-03 README.md contains "Git Worktree Setup" section with setup instructions.
- [x] AT-S08-04 No files outside whitelist touched; no new deps/endpoints/routes/storage keys.

## Evidence Paths

Evidence artifacts produced during sprint execution (ephemeral `/tmp/` paths).

## Definition of Done

- [x] All ATs pass with receipts.
- [x] Gates pass (build/lint/test EXIT 0).
- [x] PR merged via squash merge.
- [x] Repo file touches: 2 (README.md +17 lines, scripts/dev-setup.sh new 31 lines).
