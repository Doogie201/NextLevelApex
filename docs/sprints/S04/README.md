# Sprint S04 — Compare Mode MVP

| Field | Value |
|-------|-------|
| Sprint ID | `S04` |
| Name | Compare mode MVP |
| Status | done |
| Category | ux |
| Milestone | M1 |
| Baseline SHA | `931a7d3f0eb9161041f89c6a20e7a58de8103991` |
| Branch | `sprint/S04-compare-mode-mvp` |
| PR | [#111](https://github.com/Doogie201/NextLevelApex/pull/111) |

## Objective

Compare mode works with 2+ runs, disables safely with reason when <2 visible runs, uses deterministic selection policy, and renders stable share-safe diffs on partial fields. Evidence-only closeout.

## Acceptance Tests

- [x] AT-S04-01 Compare mode works when run history has 2+ visible runs.
- [x] AT-S04-02 Compare mode is disabled with clear reason when fewer than 2 visible runs.
- [x] AT-S04-03 Deterministic selection policy verified (base/target assignment deterministic).
- [x] AT-S04-04 Compare diff renders stably with partial-field runs and no UI/page errors.

## Evidence Paths

- `/tmp/S04_probe_931a7d3...json`
- `/tmp/S04_compare_disabled_reason_931a7d3...png`
- `/tmp/S04_compare_enabled_931a7d3...png`
- `/tmp/S04_compare_diff_931a7d3...png`
- `/tmp/S04_filter_state_931a7d3...png`

## Definition of Done

- [x] All ATs pass with receipts.
- [x] Gates pass (build/lint/test EXIT 0).
- [x] PR merged via squash merge.
