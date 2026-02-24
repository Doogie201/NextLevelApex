# Sprint S18 — Release Certification v2

| Field | Value |
|-------|-------|
| Sprint ID | `S18` |
| Name | Release Certification v2 |
| Status | in-review |
| Category | chore |
| Milestone | M3 |
| Baseline SHA | `c21bf51cb0e54832c30c268e51b9bf0da560e116` |
| Branch | `sprint/S18-release-cert-v2` |
| PR | [#128](https://github.com/Doogie201/NextLevelApex/pull/128) |

## Objective

Implement a release certification system that enforces main-only execution, exercises a deterministic deep-link URL matrix against a production build, and fails if runtime error overlay markers are detected in the HTML response — all without adding new dependencies.

## Architecture

Two new files under `dashboard/src/engine/`:

1. **`releaseCert.ts`** (~90 lines) — Pure logic module with types, constants, and functions for branch checking, overlay detection, URL matrix iteration, and cert orchestration.
2. **`__tests__/releaseCert.test.ts`** (~160 lines) — Vitest tests covering all acceptance tests via dependency injection.

### Design Decisions

- **No new deps**: Git checks use `child_process.execSync`, HTTP fetches use Node `fetch`.
- **Dependency injection**: `checkBranch(exec?)` and `runCert(baseUrl, exec?)` accept an optional `ExecFn` parameter, avoiding Vitest module mocking issues with Node built-ins.
- **Case-insensitive overlay detection**: `checkPageForOverlay(html)` lowercases both HTML and markers before matching.
- **Synthetic probe IDs**: URL matrix uses `evt-cert-probe` and `run-cert-probe` to exercise URL parsing without matching real data.

## Acceptance Tests

- [x] AT-S18-01 — Cert fails on non-main branch: unit test with injected exec returning non-main branch; `pass: false` with immediate stop (4 tests)
- [x] AT-S18-02 — Cert passes on main + clean tree: unit test with injected exec returning `main` + clean; `branchCheck.ok: true` (1 test)
- [x] AT-S18-03 — All URLs load with no overlay: (a) unit tests for clean/dirty HTML (7 tests), (b) runtime evidence: production build + server + curl for all 10 URLs → HTTP 200 + 0 markers

## Evidence Paths

| AT | File |
|----|------|
| AT-S18-01 | `/tmp/NLA_S18_evidence/AT01_AT02_unit_tests.txt` |
| AT-S18-02 | `/tmp/NLA_S18_evidence/AT01_AT02_unit_tests.txt` |
| AT-S18-03 | `/tmp/NLA_S18_evidence/AT03_runtime_cert.txt` |
| AT-S18-03 | `/tmp/NLA_S18_evidence/page_*.html` (10 HTML snapshots) |
| Gates | `/tmp/NLA_S18_evidence/AT02_build.txt` |
| Gates | `/tmp/NLA_S18_evidence/AT02_lint.txt` |
| Gates | `/tmp/NLA_S18_evidence/AT02_test.txt` |

## Evidence (durable)

The comprehensive cert receipt JSON is committed at [`evidence/AT05_cert_receipt.json`](evidence/AT05_cert_receipt.json). This is the durable copy of the ephemeral `/tmp/NLA_S18_evidence/` data produced during the sprint.

## Gate Receipts

| Gate | Status | Detail |
|------|--------|--------|
| `npm run build` | PASS | Next.js 16.1.6 compiled in 1.5s, TypeScript clean |
| `npm run lint` | PASS | eslint clean |
| `npm test` | PASS | 40 files, 172 tests, 0 failures |

## Diff Stats

2 files changed (new), ~250 insertions total + S18 docs update.

## Files Touched

| File | Action |
|------|--------|
| `dashboard/src/engine/releaseCert.ts` | CREATE |
| `dashboard/src/engine/__tests__/releaseCert.test.ts` | CREATE |
| `docs/sprints/S18/README.md` | EDIT |
| `docs/sprints/S18/evidence/AT05_cert_receipt.json` | CREATE |

## Definition of Done

- [x] All ATs pass with receipts.
- [x] Gates pass (build/lint/test EXIT 0).
- [ ] PR merged via squash merge.
