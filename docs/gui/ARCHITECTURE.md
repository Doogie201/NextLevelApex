# NextLevelApex GUI v1 Architecture

## Scope
GUI v1 is observability and dry-run diagnostics only. It does not mutate system state, change DNS, restart services, or run privileged commands.

## Stack
- Desktop shell target: Tauri (Rust shell, local app)
- Frontend scaffold: React + TypeScript + Vite
- Command bridge: strict allowlisted NLX subprocess execution via explicit argv arrays

## Integration Pattern
The frontend calls a single bridge function: `runCommand(commandId, args)`.

- The bridge resolves `commandId` to a fixed argv template.
- No shell expansion (`sh -c`) is allowed.
- A per-command timeout and cancellation signal prevent UI hangs.
- Output is redacted before rendering or logging.

### v1 Allowlist
- `nlx diagnose`
- `nlx list-tasks`
- `nlx --dry-run --no-reports --task <TaskName>`
- `nlx --dry-run --no-reports`

Disallowed commands are rejected before execution.

## UX Information Architecture
1. Dashboard
   - One-line health badge (`OK` / `DEGRADED` / `BROKEN`)
   - Last run timestamp
   - Primary CTA: `Run Diagnose`
2. Tasks
   - Task list
   - Run dry-run for selected task
   - Status chips (`PASS/FAIL/WARN/SKIP`)
3. Details
   - Collapsible raw stdout/stderr
   - Redacted output only
   - Copy action

## Status Mapping
`nlx diagnose` output is parsed from one exact line format. The GUI maps to:

- `OK`: parser valid, `PIHOLE=running`, `CLOUDFLARED=ok`, `PLAINTEXT_DNS=no`, resolver is private and DNS mode is `local-private` or `vpn-authoritative`.
- `DEGRADED`: parser valid but one or more key components are not healthy.
- `BROKEN`: command failure, timeout, or unparsable diagnose line.

## Security Boundaries
- Local-only operation, no telemetry in v1.
- No secret storage feature in v1.
- Redaction removes obvious secrets and sensitive file paths before display.
- Never dump full environment variable blocks.

## Runtime Controls
- Default timeout: 4500ms
- Full dry-run timeout: 15000ms
- Command cancellation support via `AbortSignal`
- Errors surfaced as user-readable messages plus redacted raw details.

## Future Tauri Wiring (Phase 2)
- Keep current bridge contract stable.
- Replace dev runner with Tauri command handler using the same allowlist and redaction policy.
- Add signed app packaging + notarization workflow.
