# Sprint S06 — Hardening & Operator Polish

| Field | Value |
|-------|-------|
| Sprint ID | `S06` |
| Name | Hardening & operator polish |
| Status | done |
| Category | docs |
| Milestone | M1 |
| Baseline SHA | `aa79c671d2f843856ecc720b0c2ae336de30cd3b` |
| Branch | `sprint/S06-hardening-operator-polish-wt` |
| PR | [#113](https://github.com/Doogie201/NextLevelApex/pull/113) |

## Objective

No white screens, stable under operator behavior, basic accessibility sanity, and no security foot-guns. Deterministic Playwright smoke receipts. Evidence-only closeout.

## Acceptance Tests

- [x] AT-S06-01 Smoke suite passes end-to-end (0 white screen failures, 0 page errors, 0 console errors).
- [x] AT-S06-02 No white screens; errors contained (invalid import shows controlled error, no raw stack traces).
- [x] AT-S06-03 build/lint/test pass (build EXIT 0, lint EXIT 0, test EXIT 0 — 144/144 passed).
- [x] AT-S06-04 No security foot-guns (0 dangerouslySetInnerHTML, 0 ts-ignore, no new fetch/localStorage, invalidDelta=0).

## Evidence Paths

- `/tmp/S06_probe_aa79c671...json`
- `/tmp/nla-s06-aa79c671.../` (screenshots directory)
- `/tmp/nla-s06-aa79c671..._bundle_export.json`

## Definition of Done

- [x] All ATs pass with receipts.
- [x] Gates pass (build/lint/test EXIT 0).
- [x] PR merged via squash merge.
