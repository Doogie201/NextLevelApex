# Sprint S23 — Governance Gates v1

| Field | Value |
|-------|-------|
| Sprint ID | `S23` |
| Name | Governance Gates v1 (Automation PR exception + Codecov docs-only pass) |
| Status | in-progress |
| Category | devops |
| Milestone | M4 |
| Baseline SHA | `d19e39fb59983f84b14496ecb850dac0bfb877ec` |
| Branch | `sprint/S23-governance-gates-v1` |
| PR | — |
| Dependencies | S22 |

## Objective

Unblock docs-only PR merges and enforce deterministic PR hygiene without weakening security or coverage discipline for code changes.

## Work Plan / Scope

- **S23.A1** Document "Open PR Handling Protocol — Automation Exception" in `docs/governance/pr-gates.md`.
- **S23.A2** Document "Codecov required-check behavior" policy in the same file.
- **S23.B1** Capture branch protection baseline (before change).
- **S23.B2** Remove `codecov/patch` from required checks (keeps coverage discipline via `build-test --fail-under`).
- **S23.C1** Codify updated agent open-PR protocol in `docs/governance/agent-protocol.md`.
- Whitelist: `docs/`, `.github/`, `/tmp/**`.

## Acceptance Tests

- [ ] AT-S23-01 Branch protection BEFORE snapshot captured (JSON).
- [ ] AT-S23-02 Branch protection AFTER snapshot captured (JSON).
- [ ] AT-S23-03 Docs-only PR mergeable without missing required checks (PR #124).
- [ ] AT-S23-04 Coverage discipline for code PRs remains enforced.
- [ ] AT-S23-05 Governance doc includes explicit automation-PR allowlist and retains HARD STOP.
- [ ] AT-S23-06 Agent protocol text updated to implement the same allowlist.

## Evidence Paths

- `/tmp/NLA_S23_branch_protection_before.json`
- `/tmp/NLA_S23_branch_protection_after.json`
- PR #124 merge event (2026-02-24T01:45:41Z)
- `docs/governance/pr-gates.md`
- `docs/governance/agent-protocol.md`

## Definition of Done

- [ ] All ATs pass with receipts.
- [ ] Branch protection updated so docs-only PRs are not blocked.
- [ ] Automation PR exception codified with narrow allowlist.
- [ ] Agent protocol updated to comply.
- [ ] PR merged via squash merge.
