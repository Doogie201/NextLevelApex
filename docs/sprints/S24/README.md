# S24 — S18 Cert Validation Hardening (Harness-Based)

## Sprint ID
`S24-s18-validation`

## Objective
Validate that the S18/S18v2 cert cannot false-PASS when stderr/hydration failures occur with HTTP 200 using a harness-based approach (DI + fixtures), and audit main to ensure zero crash-probe remnants or runtime behavior flips in app routes.

## Branch
`sprint/S24-s18-validation`

## Approach: Harness-Based Proof (No Crash Probes)

This sprint does NOT inject crash toggles, env-var switches, or `force-dynamic` into production pages. All proof is via DI + fixture-based harness tests:

- **Fixtures**: fake HTML responses + fake server log content
- **DI**: `checkPageForOverlay()` and `checkServerLog()` accept direct input
- **Composed proof**: old cert logic vs new cert logic, evaluated in-test

## Work Plan

1. **Audit app routes** — grep `dashboard/src/app/` for crash-probe remnants (`CERT_*`, `force-dynamic`, injected throws)
2. **Build harness fixtures** — clean HTML (200), crash stderr log, clean stderr log
3. **Prove overlay fallacy** — show `checkPageForOverlay(cleanHTML)` returns `overlayDetected: false` (old cert would PASS)
4. **Prove upgraded cert fails** — compose: 200 + no overlay + crash stderr → old cert PASS, new cert FAIL
5. **Prove upgraded cert passes clean** — compose: 200 + no overlay + clean stderr → new cert PASS
6. **Verify main-only enforcement** — existing `checkBranch` tests prove hard-stop on non-main
7. **Fail-closed log collection** — if `serverLogPath` is provided but unreadable, cert must FAIL (not silently PASS)

## Acceptance Tests

- [x] **AT-S24-01** — Audit PASS: grep of `dashboard/src/app/` for `CERT_CRASH_TEST`, `force-dynamic`, `S24-CRASH-PROBE`, and injected throws returned zero matches. `page.tsx` is original 5-line file. `/` route is `○ (Static)`.
- [x] **AT-S24-02** — Proof PASS: harness test `AT-S24-02: clean HTML passes old overlay-only detection` proves clean HTML with status 200 passes overlay-only detection (false-PASS scenario for old cert).
- [x] **AT-S24-03** — Upgrade PASS: harness test `AT-S24-03: upgraded cert FAILS for 200 + clean HTML + stderr crash` proves composed new logic fails when stderr has crash signals even though old logic would pass.
- [x] **AT-S24-04** — Clean PASS: harness test `AT-S24-04: upgraded cert PASSES for 200 + clean HTML + clean stderr` proves new logic passes when both HTML and stderr are clean.
- [x] **AT-S24-05** — Main-only enforcement preserved: existing `checkBranch` tests prove `ok:false` for non-main branches and dirty trees. `runCert` returns `pass:false` with empty pages when branch is not main.
- [x] **AT-S24-06** — Fail-closed log collection: `checkServerLog` returns `ok:false` with `LOG_READ_FAILED` marker when `logPath` is provided but file is unreadable. Prevents silent false-PASS due to missing evidence.

## Definition of Done

- All 6 ATs checked
- No crash probes / env-var toggles / force-dynamic in app routes
- Tests: 182 passed (40 files)
- Lint: clean
- Build: clean (`/` is `○ Static`)
- No files outside whitelist touched
- Maintainability budgets within limits

## Evidence

See `docs/sprints/S24/evidence/` for JSON receipts.

## Marker/Signature Lists

### OVERLAY_MARKERS (HTML body scan — existing from S18, retained)
```
nextjs-portal, data-nextjs-dialog, data-nextjs-error, nextjs__container_errors,
Unhandled Runtime Error, Maximum update depth exceeded, Internal Server Error,
Application error: a server-side exception has occurred, Hydration failed
```

### STDERR_SIGNATURES (server log scan — new in S24)
```
⨯ Error, TypeError:, ReferenceError:, SyntaxError:, RangeError:,
ECONNREFUSED, EADDRINUSE, unhandledRejection, uncaughtException,
Hydration failed, digest:, server-side exception
```

## Files Touched
| File | Before | After | Net New |
|------|--------|-------|---------|
| `dashboard/src/engine/releaseCert.ts` | 99 | 168 | +69 |
| `dashboard/src/engine/__tests__/releaseCert.test.ts` | 165 | 267 | +102 |
