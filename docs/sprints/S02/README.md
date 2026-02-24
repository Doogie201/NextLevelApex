# Sprint S02 — Run Execution Lifecycle

| Field | Value |
|-------|-------|
| Sprint ID | `S02` |
| Name | Run execution lifecycle |
| Status | done |
| Category | chore |
| Milestone | M1 |
| Baseline SHA | `1e5fc01668f809545edf238cefc3dd2ffd659f65` |
| Branch | `sprint/S02-run-execution-lifecycle` |
| PR | [#108](https://github.com/Doogie201/NextLevelApex/pull/108) |

## Objective

Run execution lifecycle (diagnose + dry-run) initiatable, observable, and operator-safe. Evidence-only closeout.

## Acceptance Tests

- [x] AT-S02-01 One POST /api/nlx/run with commandId=diagnose per click.
- [x] AT-S02-02 idle -> running -> completed transitions observed.
- [x] AT-S02-03 Run button disabled while running; second click rejected.
- [x] AT-S02-04 Actionable failure message, no raw stack in UI message.
- [x] AT-S02-05 build/lint/test all pass.

## Evidence Paths

- `/tmp/S02_idle_1e5fc01...png`
- `/tmp/S02_running_1e5fc01...png`
- `/tmp/S02_completed_1e5fc01...png`
- `/tmp/S02_failure_1e5fc01...png`

## Definition of Done

- [x] All ATs pass with receipts.
- [x] Gates pass (build EXIT 0, lint EXIT 0, test EXIT 0).
- [x] PR merged via squash merge.
