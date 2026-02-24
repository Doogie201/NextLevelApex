# Sprint S22 — Backlog Index Layout

| Field | Value |
|-------|-------|
| Sprint ID | `S22` |
| Name | Backlog Index Layout |
| Status | done |
| Category | docs |
| Milestone | M1 |
| Baseline SHA | `3b65b97720cf562ecc85875a2b8f864868244385` |
| Branch | `sprint/S22-backlog-index-layout` |
| PR | [#124](https://github.com/Doogie201/NextLevelApex/pull/124) |

## Objective

Add a single deterministic index layout for sprint docs (one folder per sprint + a master backlog README) without restructuring existing files.

## Work Plan / Scope

- Create `docs/backlog/README.md` (master sprint index with milestone mapping).
- Create `docs/backlog/milestones.md` (milestone definitions).
- Create `docs/sprints/README.md` (sprint folder quick links).
- Create `docs/sprints/SXX/README.md` for S01–S22 (standardized sprint format).
- Whitelist: `docs/backlog/`, `docs/sprints/`, `/tmp/**`.

## Acceptance Tests

- [ ] AT-S22-01 Master backlog README exists and contains links to each sprint folder S01–S22.
- [ ] AT-S22-02 Each sprint folder contains a README template stub matching the standardized format (header/ATs/evidence/DoD).
- [ ] AT-S22-03 No files outside the whitelist are touched; no new deps/endpoints/routes/storage keys.

## Evidence Paths

TBD — to be produced during this sprint.

## Definition of Done

- [ ] All ATs pass with receipts.
- [ ] Gates pass (build/lint/test EXIT 0).
- [ ] PR merged via squash merge.
