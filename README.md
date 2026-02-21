# NextLevelApex

NextLevelApex is a security-focused macOS setup orchestrator for running repeatable workstation and DNS-stack tasks with drift detection, health tracking, diagnostics, and report generation.

## Who This Is For

- Developers automating macOS bootstrap and maintenance
- Operators managing local Cloudflared/Pi-hole workflows
- Teams that need repeatable CLI + API orchestration with auditability

## High-Level Architecture

- Canonical CLI orchestrator: `nextlevelapex/main2.py` (exposed as `nlx`)
- Compatibility shim for legacy module invocations: `nextlevelapex/main.py`
- Task registry and guarded discovery: `nextlevelapex/core/registry.py`
- State tracking and drift detection: `nextlevelapex/core/state.py`
- Atomic report generation: `nextlevelapex/core/report.py`
- API wrapper: `nextlevelapex/api/main.py` (FastAPI)
- Optional web dashboard: `dashboard/` (Next.js)

## Supported Platforms

- Primary runtime target: macOS (Darwin)
- Development and most tests: macOS/Linux
- `install-sudoers` is intentionally macOS-only

## Prerequisites

- Python 3.11+
- Poetry
- Optional for DNS stack tasks: Homebrew, Colima, Docker

## Installation

```bash
git clone https://github.com/Doogie201/NextLevelApex.git
cd NextLevelApex
poetry install
```

## Quickstart

List commands:

```bash
poetry run nlx --help
```

Run orchestrator in dry-run mode without generating reports:

```bash
poetry run nlx --dry-run --no-reports
```

Inspect discovered task states:

```bash
poetry run nlx list-tasks
```

Generate reports from current state:

```bash
poetry run nlx report
```

Run the API server:

```bash
poetry run uvicorn nextlevelapex.api.main:app --reload
```

## Security Posture

NextLevelApex is hardened around least privilege and trust-boundary control:

- Task provenance gates block untrusted module execution.
- Remediation shell actions are allowlisted (no arbitrary shell payload execution).
- `install-sudoers` validates interface and username formats, renders deterministic sudoers rules, and validates syntax with `visudo` before install.
- Sudoers verification fails closed if `includedir` cannot be verified non-interactively.
- State and reports use atomic writes to reduce corruption risk.

See also:

- `SECURITY.md`
- `SECURITY_NOTES.md`

## Development and Validation

```bash
poetry run pytest -q
poetry run ruff check .
poetry run black --check .
poetry run isort --check-only .
poetry run mypy .
```

## Troubleshooting

- `ModuleNotFoundError` for dependencies:
  - Use `poetry run ...` or activate Poetry's environment.
- `install-sudoers` cannot verify `includedir`:
  - Run `sudo visudo` and ensure one of these exists:
    - `#includedir /private/etc/sudoers.d`
    - `#includedir /etc/sudoers.d`
- Selective task execution:
  - Use `--task` filters to target specific tasks.

## Contributing

See `CONTRIBUTING.md` for branching, checks, and PR expectations.

## License

This project is licensed under the MIT License. See `LICENSE`.
