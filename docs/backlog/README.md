# NextLevelApex — Sprint Backlog

Master index for all sprints, milestones, and planning artifacts.

## Milestones

See [milestones.md](milestones.md) for milestone definitions and mapping rules.

## Sprint Table

| Sprint | Name | Status | Category | Milestone | PR | Sprint Folder |
|--------|------|--------|----------|-----------|----|---------------|
| S01 | Nav history back/forward determinism | done | nav | M1 | [#107](https://github.com/Doogie201/NextLevelApex/pull/107) | [S01](../sprints/S01/) |
| S02 | Run execution lifecycle | done | chore | M1 | [#108](https://github.com/Doogie201/NextLevelApex/pull/108) | [S02](../sprints/S02/) |
| S03 | Run history replay MVP | done | ux | M1 | [#110](https://github.com/Doogie201/NextLevelApex/pull/110) | [S03](../sprints/S03/) |
| S04 | Compare mode MVP | done | ux | M1 | [#111](https://github.com/Doogie201/NextLevelApex/pull/111) | [S04](../sprints/S04/) |
| S05 | Export/import MVP | done | ux | M1 | [#112](https://github.com/Doogie201/NextLevelApex/pull/112) | [S05](../sprints/S05/) |
| S06 | Hardening & operator polish | done | docs | M1 | [#113](https://github.com/Doogie201/NextLevelApex/pull/113) | [S06](../sprints/S06/) |
| S07 | Tooltip system global coverage | done | ux | M1 | [#114](https://github.com/Doogie201/NextLevelApex/pull/114) | [S07](../sprints/S07/) |
| S08 | Dev setup guardrails | done | docs | M1 | [#115](https://github.com/Doogie201/NextLevelApex/pull/115) | [S08](../sprints/S08/) |
| S09 | Visual Foundations & Token System Lock | backlog | ux | M2 | — | [S09](../sprints/S09/) |
| S10 | Per-Mode Theming + Page Transitions | backlog | ux | M2 | — | [S10](../sprints/S10/) |
| S11 | Ambient 3D + Glow | backlog | ux | M2 | — | [S11](../sprints/S11/) |
| S12 | Live Output v1 | backlog | ux | M2 | — | [S12](../sprints/S12/) |
| S13 | Live Output v2 | backlog | ux | M2 | — | [S13](../sprints/S13/) |
| S14 | Navigation IA + Microinteractions | backlog | nav | M2 | — | [S14](../sprints/S14/) |
| S15 | Performance + Accessibility Hardening | backlog | perf | M3 | — | [S15](../sprints/S15/) |
| S16 | Operator-Grade QA Megasuite | backlog | test | M3 | — | [S16](../sprints/S16/) |
| S17 | URL Sync Loop Hardening | backlog | bug | M3 | — | [S17](../sprints/S17/) |
| S18 | Release Certification v2 | backlog | chore | M3 | — | [S18](../sprints/S18/) |
| S19 | Worktree + Poetry Guardrails v2 | backlog | chore | M3 | — | [S19](../sprints/S19/) |
| S20 | Governance: DoD + Stop Conditions | backlog | docs | M4 | — | [S20](../sprints/S20/) |
| S21 | Operator Execution Safety System (OESS) | backlog | security | M4 | — | [S21](../sprints/S21/) |
| S22 | Backlog Index Layout | in-progress | docs | M1 | — | [S22](../sprints/S22/) |

## Renumbering Note

Sprints S01 through S08 were shipped sequentially under the original numbering. Starting at S09, sprint IDs reflect the master backlog order established in this index. If a sprint was previously referenced under a different number in conversation or planning artifacts, the canonical ID is the one in this table.

## Contribution Rules

- One sprint = one PR. Squash merge preferred.
- PR title format: `[SXX] category : description`
- Category enum: `nav`, `ux`, `bug`, `perf`, `refactor`, `test`, `chore`, `docs`, `security`
- Every PR must include: AT checklist, evidence paths, gate receipts.
- See [CONTRIBUTING.md](../../CONTRIBUTING.md) for full branching and review expectations.
