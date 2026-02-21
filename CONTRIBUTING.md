# Contributing to NextLevelApex

## Branching Strategy

- Default branch: `main`
- Create focused branches from `main`:
  - `feature/<short-description>`
  - `fix/<short-description>`
  - `security/<short-description>`
  - `chore/<short-description>`
- Never force-push to `main`.

## Commit Conventions

Use small, reviewable commits with clear intent. Conventional Commit style is preferred:

- `feat: ...`
- `fix: ...`
- `security: ...`
- `docs: ...`
- `ci: ...`
- `chore: ...`

## Local Setup

```bash
poetry install
```

## Required Checks Before PR

```bash
poetry run ruff check .
poetry run black --check .
poetry run isort --check-only .
poetry run mypy .
poetry run pytest -q
```

If you change security-sensitive code paths (`install-sudoers`, remediation execution, task discovery, state/report writes), add or update tests in `tests/core/`.

## Coverage Gate Policy

- CI enforces a conservative baseline floor with `coverage report --fail-under=40`.
- `codecov.yml` currently uses `target: auto` for project/patch and `if_not_found: success` for patch status.
- Reason: bootstrap period while establishing a stable base commit coverage history on Codecov.
- Revisit owner/timing: release manager must tighten thresholds and restore fully blocking static targets on the first release after baseline coverage is available on `main`.

## Pull Request Standards

Each PR should include:

- Clear summary of what changed and why
- Risk assessment and rollback notes
- Security impact notes (if any)
- Test evidence (exact commands + outcomes)

## Review Checklist

- [ ] No secrets or local artifacts added
- [ ] No trust-boundary expansion without explicit rationale
- [ ] Least-privilege behavior preserved
- [ ] Documentation updated when behavior changes
- [ ] CI passes

## Security Reporting

Do not open public issues for suspected vulnerabilities.

Use the guidance in `SECURITY.md`.
