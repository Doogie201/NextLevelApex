# Sprint S19 — Worktree + Poetry Guardrails v2

| Field | Value |
|-------|-------|
| Sprint ID | `S19-worktree-poetry-guardrails-v2` |
| Name | Worktree + Poetry Guardrails v2 |
| Status | in-progress |
| Category | devops |
| Milestone | M3 |
| Baseline SHA | `339338f` |
| Branch | `sprint/S19-worktree-poetry-guardrails-v2` |
| PR | — |

## Objective

Make diagnose work from any git worktree by capturing invocation context (cwd/interpreter/env), replacing raw tracebacks with a controlled message + one canonical fix path, and optionally offering a safe setup button that requires explicit confirmation; ensure dev setup is idempotent and offline-friendly.

## Approach

1. **`worktreeContext.ts`** — DI-testable module that detects git worktree status, Python interpreter path, and nlx availability via shell commands.
2. **`nlxErrorSanitizer.ts`** — Intercepts raw Python tracebacks and `missing_nlx` errors, replacing them with controlled messages containing exactly one canonical remediation: `bash scripts/dev-setup.sh`.
3. **`nlxService.ts` wiring** — The `toResponse()` function routes error states through the sanitizer before returning to the API layer.
4. **`scripts/dev-setup.sh` hardening** — Worktree detection, `--offline` flag, context logging.

## Work Plan

1. **Create `worktreeContext.ts`** — DI-testable context detection (cwd, gitTopLevel, isWorktree, interpreterPath, nlxAvailable)
2. **Create `nlxErrorSanitizer.ts`** — Traceback pattern matching + controlled message generation
3. **Wire sanitizer into `nlxService.ts`** — Replace raw stderr on `missing_nlx` and traceback-containing `nonzero_exit`
4. **Harden `scripts/dev-setup.sh`** — Worktree detection, `--offline` flag, idempotency
5. **Write unit tests** — DI fixtures for worktree context, traceback suppression, passthrough

## Acceptance Tests

- [x] **AT-S19-01** — Worktree context detection: `detectWorktreeContext()` returns `{cwd, gitTopLevel, isWorktree, interpreterPath, nlxAvailable}` with deterministic values via DI shell mock. Worktree detected when `git-common-dir` differs from `git-dir`.
- [x] **AT-S19-02** — Traceback suppression: `sanitizeNlxError()` returns controlled message with exactly one canonical fix path (`bash scripts/dev-setup.sh`) when stderr contains Python traceback patterns or errorType is `missing_nlx`. No raw stack frames leak.
- [x] **AT-S19-03** — Dev-setup is idempotent and offline-friendly: `scripts/dev-setup.sh` detects worktree context, supports `--offline` flag to skip network-dependent steps, and exits 0 on repeated runs.
- [x] **AT-S19-04** — Error context attached: sanitized error includes `WorktreeContext` object with `isWorktree`, `interpreterPath`, and `nlxAvailable` fields. API envelope receives controlled stderr instead of raw traceback.

## Definition of Done

- All 4 ATs checked
- No raw Python tracebacks in error responses
- Tests: 195 passed (42 files)
- Lint: clean
- Build: clean (`/` is `○ Static`)
- No files outside whitelist touched
- Maintainability budgets within limits

## Traceback Patterns (suppressed)

```
Traceback (most recent call last)
File "...", line N
ModuleNotFoundError:
ImportError:
FileNotFoundError:.*poetry
No module named
```

## Evidence

See `docs/sprints/S19/evidence/` for JSON receipts.

## Files Touched

| File | Before | After | Net New |
|------|--------|-------|---------|
| `dashboard/src/engine/worktreeContext.ts` | 0 | 40 | +40 (new) |
| `dashboard/src/engine/nlxErrorSanitizer.ts` | 0 | 64 | +64 (new) |
| `dashboard/src/engine/nlxService.ts` | 129 | 144 | +15 |
| `dashboard/src/engine/__tests__/worktreeContext.test.ts` | 0 | 52 | +52 (new) |
| `dashboard/src/engine/__tests__/nlxErrorSanitizer.test.ts` | 0 | 94 | +94 (new) |
| `scripts/dev-setup.sh` | 34 | 63 | +29 |
