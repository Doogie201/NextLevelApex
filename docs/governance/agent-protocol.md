# Agent Sprint Execution Protocol — Open PR Handling

> Canonical reference for the open-PR disposition step that every
> agent-driven sprint must execute before starting work. Added in
> Sprint S23; see `docs/governance/pr-gates.md` for the full policy.

---

## Step 0 — Inventory and Classify Open PRs

Before any sprint work begins, run:

```
gh pr list --repo <owner>/<repo> --state open \
  --json number,title,author,labels,headRefName
```

### Classification Rules

Classify each open PR into one of three categories:

| Category | Condition | Action |
|---|---|---|
| **Previous sprint** | PR belongs to the immediately preceding sprint (e.g. S22 when starting S23). | Allowed. Note in evidence bundle. |
| **Automation (allowlist)** | ALL of: (a) author is `dependabot` or `pre-commit-ci`, (b) PR has label `automation:approved` OR `type:automation`, (c) base branch is `main`. | Allowed. Log in evidence bundle and proceed. |
| **Everything else** | Any open PR that does not match the above two categories. | **HARD STOP.** Do not proceed. Report the blocking PR(s) and wait for human disposition. |

### Decision Flow

```
for each open PR:
  if PR.branch matches previous sprint pattern → ALLOW
  if PR.author in {dependabot, pre-commit-ci}
     AND PR.labels intersect {automation:approved, type:automation}
     AND PR.base == main                        → ALLOW (automation)
  else                                          → HARD STOP
```

### Evidence Requirement

The sprint evidence bundle must include:

1. The raw `gh pr list` output.
2. Classification of each open PR (category + reasoning).
3. Explicit statement: "No blocking PRs found" or "HARD STOP: PR #N is
   blocking" with the PR number and title.

---

## Examples

### Example A — Automation PRs present, no blockers

```
Open PRs:
  #118  chore(deps): bump actions/upload-artifact from 4 to 6
        author: dependabot  labels: [dependencies]  base: main
  #116  [pre-commit.ci] pre-commit autoupdate
        author: pre-commit-ci  labels: []  base: main

Classification:
  #118 → automation allowlist (author=dependabot, label TBD, base=main)
  #116 → automation allowlist (author=pre-commit-ci, base=main)

Result: PROCEED. Both PRs meet allowlist conditions.
```

### Example B — Random PR blocks sprint

```
Open PRs:
  #130  WIP: experimental dashboard redesign
        author: contributor  labels: []  base: main

Classification:
  #130 → does NOT match previous sprint, does NOT match automation allowlist.

Result: HARD STOP. PR #130 must be closed, merged, or moved to a
non-main base before sprint work can begin.
```
