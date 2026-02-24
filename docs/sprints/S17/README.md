# Sprint S17 — URL Sync Loop Hardening

| Field | Value |
|-------|-------|
| Sprint ID | `S17` |
| Name | URL Sync Loop Hardening |
| Status | done |
| Category | bug |
| Milestone | M3 |
| Baseline SHA | `50c634f7c06e635f8fc46bf747ac0156feb4960e` |
| Branch | `sprint/S17-url-sync-loop-hardening` |
| PR | [#126](https://github.com/Doogie201/NextLevelApex/pull/126) |

## Objective

Fix "Maximum update depth exceeded" caused by two bidirectional `useEffect` blocks in `HomePage.tsx` that oscillated between `selectedEventId` and `selectedSessionId`.

## Root Cause

Two effects with shared dependency `[runSessions, selectedEventId, selectedSessionId]`:
- **Effect A** (lines 838-846): `selectedEventId` changes → finds first session → `setSelectedSessionId()`
- **Effect B** (lines 848-859): `selectedSessionId` changes → finds parent event → `setSelectedEventId()`

When a deep-link URL set both values simultaneously (session not being the first match for its event), the effects ping-ponged until React threw.

## Fix

1. **New pure resolver** (`dashboard/src/engine/sessionEventSync.ts`): `resolveSessionEventPair()` computes the canonical `(eventId, sessionId)` pair in one pass. Idempotent: `resolve(resolve(x)) === resolve(x)`.
2. **Replaced 2 effects with 1** in `HomePage.tsx`: single merged effect calls the resolver and only sets state if the resolved pair differs from current.
3. **Regression tests** (`dashboard/src/engine/__tests__/sessionEventSync.test.ts`): 8 tests including idempotency proof.

## Acceptance Tests

- [x] AT-S17-01 — Baseline proof: bidirectional effects existed on `main` (lines 838-859)
- [x] AT-S17-02 — Build, lint, test all pass (152/152 tests, 0 failures)
- [x] AT-S17-03 — Idempotency test passes: `resolve(resolve(x)) === resolve(x)` for 6 inputs
- [x] AT-S17-04 — Back/forward stable: popstate handler untouched, urlState round-trip 5/5
- [x] AT-S17-05 — Cert receipt JSON with all evidence paths

## Evidence Paths

| AT | File |
|----|------|
| AT-S17-01 | `/tmp/NLA_S17_evidence/AT01_baseline_effects.txt` |
| AT-S17-01 | `/tmp/NLA_S17_evidence/AT01_fixed_effects.txt` |
| AT-S17-01 | `/tmp/NLA_S17_evidence/AT01_homepage_diff.patch` |
| AT-S17-02 | `/tmp/NLA_S17_evidence/AT02_build.txt` |
| AT-S17-02 | `/tmp/NLA_S17_evidence/AT02_lint.txt` |
| AT-S17-02 | `/tmp/NLA_S17_evidence/AT02_full_test.txt` |
| AT-S17-03 | `/tmp/NLA_S17_evidence/AT03_idempotency_test.txt` |
| AT-S17-04 | `/tmp/NLA_S17_evidence/AT04_popstate_proof.txt` |
| AT-S17-04 | `/tmp/NLA_S17_evidence/AT04_urlstate_test.txt` |
| AT-S17-05 | `/tmp/NLA_S17_evidence/AT05_cert_receipt.json` |

## Gate Receipts

| Gate | Status | Detail |
|------|--------|--------|
| `npm run build` | PASS | next build compiled in 2.1s, TypeScript clean |
| `npm run lint` | PASS | eslint clean |
| `npm test` | PASS | 39 files, 152 tests, 0 failures |
| CI build-test (3.11) | SUCCESS | — |
| CI build-test (3.12) | SUCCESS | — |
| CI CodeQL | SUCCESS | — |
| CI codecov/patch | SUCCESS | — |
| CI pre-commit.ci | SUCCESS | — |

## Diff Stats

3 files changed, 137 insertions, 16 deletions (net -9 lines in HomePage.tsx)

## Definition of Done

- [x] All ATs pass with receipts.
- [x] Gates pass (build/lint/test EXIT 0).
- [ ] PR merged via squash merge.
