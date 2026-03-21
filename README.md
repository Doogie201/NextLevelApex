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
- Canonical web GUI (read-only v1): `dashboard/` (Next.js)

## Canonical Single-Device DNS Stack

The authoritative local-device DNS path for this Mac is:

```text
This Mac -> 192.168.64.2 -> Pi-hole in Docker on Colima -> host.docker.internal#5053 -> host cloudflared on 127.0.0.1:5053 -> Cloudflare DoH
```

The canonical orchestrator entrypoint for that stack is the `DNS Stack Setup` task.

```bash
poetry run nlx --task "DNS Stack Setup" --no-reports
```

Supporting assumptions encoded in the repo:

- `192.168.64.2` is the canonical Colima reachable resolver IP.
- Pi-hole runs from a pinned image reference.
- cloudflared runs as a host LaunchAgent, not as a container.
- Pi-hole must use `host.docker.internal#5053` as its sole upstream.
- Legacy Unbound-based files under `docker/unbound/` and `tests/stack-sanity.sh` are quarantined reference-only artifacts, not supported control paths for this Mac.

### Fresh-Machine cloudflared Bootstrap

The canonical `DNS Stack Setup` task now handles exact-version `cloudflared` bootstrap deliberately:

- If the preferred binary at `/opt/homebrew/bin/cloudflared` already matches the required version, the task reuses it.
- If that binary is absent or version-mismatched, the task bootstraps the exact GitHub release asset for this Mac, caches the archive under `~/.cache/nextlevelapex/cloudflared/<version>/`, and installs a stable exact-version binary link at `~/.local/share/nextlevelapex/bin/cloudflared`.
- The LaunchAgent is rendered against the exact binary path selected by the orchestrator, not whatever happens to be first in `PATH`.
- If the required release cannot be obtained or verified exactly, the task fails closed and reports the exact release URL and observed version drift in task evidence.

Recovery guidance:

- Re-run `poetry run nlx --task "DNS Stack Setup" --no-reports` after network/package issues are fixed.
- If GitHub release download is blocked, place the exact required release where the task expects it or install that exact version at `/opt/homebrew/bin/cloudflared`.
- Do not use `docker/orchestrate.sh`, `docker/unbound/`, or `tests/stack-sanity.sh` to recover the canonical single-device stack. Those paths are legacy reference material only.

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

Plain `poetry install` is the canonical install contract for this repo. The `nlx` CLI
and its Typer runtime are part of the default dependency set, so no optional CLI extra
is required or supported for standard operator and CI workflows.

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

Run the canonical GUI dashboard:

```bash
npm --prefix dashboard install
npm --prefix dashboard run dev -- --hostname 127.0.0.1 --port 4010
```

GUI v1 is read-only: it supports diagnose + dry-run workflows only and ships no mutation endpoints.

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

## Git Worktree Setup

Poetry creates a separate virtualenv for each project path. When using `git worktree`, each worktree needs its own `poetry install`:

```bash
git worktree add ../my-worktree main
cd ../my-worktree
bash scripts/dev-setup.sh   # installs Poetry deps + dashboard deps
```

Or manually:

```bash
poetry install               # Python deps + nlx entrypoint
npm --prefix dashboard ci    # dashboard deps
```

Without this, you will see:

- `Warning: 'nlx' is an entry point defined in pyproject.toml, but it's not installed as a script`
- `ModuleNotFoundError: No module named 'typer'` (or other deps)

## Troubleshooting

- `ModuleNotFoundError` for dependencies:
  - Run `poetry install` then use `poetry run ...` or activate Poetry's environment.
  - In a git worktree, you must run `poetry install` in each worktree separately.
  - If plain `poetry install` does not make `poetry run nlx --help` work, treat that as a
    packaging or lockfile contract bug, not as a missing optional extra.
- `Warning: 'nlx' is an entry point ... not installed as a script`:
  - Run `poetry install` to register the entrypoint.
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
