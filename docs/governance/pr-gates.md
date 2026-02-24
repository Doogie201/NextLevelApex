# PR Gate Policies

> Single source of truth for branch-protection and PR-handling rules
> that affect merge eligibility. Added in Sprint S23.

---

## 1. Open PR Handling Protocol — Automation Exception

The default sprint protocol requires a **HARD STOP** when unrelated
open PRs exist against `main`. The following narrow exception applies
to automated dependency and tooling PRs:

> **Automation PRs are allowed to remain open and do not block sprint
> work ONLY if: (1) author is dependabot or pre-commit-ci, AND (2) PR
> has label `automation:approved` OR `type:automation`, AND (3) base
> branch is `main`.**

> **All other unrelated open PRs still cause HARD STOP.**

### Rationale

Dependabot and pre-commit-ci PRs arrive on their own cadence and are
outside sprint scope. Blocking every sprint on their disposition adds
no safety value because they never touch application logic or sprint
deliverables. The allowlist is intentionally narrow: author identity,
label, and base branch must all match.

---

## 2. Codecov Required-Check Behavior

### Problem

`codecov/patch` was a required status check on `main`. When a PR
contains only documentation changes (no coverable source lines),
Codecov has nothing to report — it never posts the GitHub status check.
The PR is permanently blocked by a "not reporting" required check.

### Resolution (S23)

`codecov/patch` was **removed from required status checks**. Coverage
discipline for code-changing PRs is maintained by:

1. **`build-test` jobs** run `pytest --fail-under=40`, which fails the
   entire CI build if project coverage drops below the threshold.
2. **`codecov/patch`** still posts as an informational (non-required)
   status on PRs that touch coverable code — reviewers see it, but it
   does not block merge.
3. **`codecov.yml`** thresholds (project: auto/5%, patch: auto/5%)
   remain enforced by the Codecov service and appear in PR comments.

### Policy

Docs-only PRs must not be forced to add no-op code changes to satisfy
CI. Required checks must either report deterministically for all diff
types or be scoped so that docs-only diffs are not blocked.
