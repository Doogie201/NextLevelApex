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
