# Sprint S04 Closeout (Evidence Only)

- Sprint ID: `S04-compare-mode-mvp`
- Baseline SHA: `931a7d3f0eb9161041f89c6a20e7a58de8103991`
- Objective: Compare mode works with `2+` runs, disables safely with reason when `<2` visible runs, uses deterministic selection policy, and renders stable share-safe diffs on partial fields.
- Whitelist: `dashboard/src/app/home/**`, `/tmp/**`
- Repo file touches: `1`
- Functional code changes: `none`

## Budgets Used

- Max net new lines per existing file: `120` (used `0`)
- Max total LOC per touched file: `1200` (actual file LOC `39`)
- Max function length: `80` (used `0`)
- Max new hooks per touched file: `1` (used `0`)
- Max new useEffect blocks per touched file: `1` (used `0`)

## Acceptance Tests

- [x] AT-S04-01 Compare mode works when run history has `2+` visible runs.
- [x] AT-S04-02 Compare mode is disabled with clear reason when fewer than `2` visible runs.
- [x] AT-S04-03 Deterministic selection policy verified (base/target assignment deterministic; roles clear deterministically when filtered out).
- [x] AT-S04-04 Compare diff renders stably with partial-field runs and no UI/page errors.

## Runtime Evidence Paths (/tmp)

- Probe JSON: `/tmp/S04_probe_931a7d3f0eb9161041f89c6a20e7a58de8103991.json`
- Probe run log: `/tmp/S04_probe_run_931a7d3f0eb9161041f89c6a20e7a58de8103991.log`
- Screenshot: `/tmp/S04_compare_disabled_reason_931a7d3f0eb9161041f89c6a20e7a58de8103991.png`
- Screenshot: `/tmp/S04_compare_enabled_931a7d3f0eb9161041f89c6a20e7a58de8103991.png`
- Screenshot: `/tmp/S04_compare_diff_931a7d3f0eb9161041f89c6a20e7a58de8103991.png`
- Screenshot: `/tmp/S04_filter_state_931a7d3f0eb9161041f89c6a20e7a58de8103991.png`

## Probe Summary

- `allPassed: true`
- `diagnoseRequestCount: 1`
- `requestCount: 2`
- `consoleErrorsCount: 0`
- `pageErrorsCount: 0`
