# NextLevelApex Dashboard (Canonical GUI)

This directory is the **single canonical GUI** for NextLevelApex.

## Scope (v1)
- Read-only diagnostics and observability.
- Uses an allowlisted NLX bridge for:
  - `nlx diagnose`
  - `nlx list-tasks`
  - `nlx --dry-run --no-reports`
  - `nlx --dry-run --no-reports --task <TaskName>`
- No mutate endpoints are shipped in v1.
- Output viewer shows redacted stdout/stderr with command timing metadata.
- Premium v1 layout includes health bar, navigation rail, and inspector panel.
- Output timeline supports severity filtering, search, collapsible groups (task and severity),
  in-browser redacted copy, and client-side redacted log download.

## Phase 5A highlights
- `Copy redacted` now always copies the redacted output model, never raw command text.
- `Download redacted log` exports a redacted text log client-side with no server file writes.
- Timeline grouping and collapsing improve scanability for mixed PASS/WARN/FAIL task output.
- Screenshots:
  - `dashboard/docs/screenshots/phase5a-dashboard-main.png`
  - `dashboard/docs/screenshots/phase5a-output-viewer.png`

## Run locally
```bash
npm --prefix dashboard install
npm --prefix dashboard run dev -- --hostname 127.0.0.1 --port 4010
```

Open <http://127.0.0.1:4010>.

## Read-only mode
Read-only mode is enabled by default.

- Environment variable: `NLX_GUI_READ_ONLY`
- Default behavior: if unset, treated as `true`

## Test
```bash
npm --prefix dashboard test
```
