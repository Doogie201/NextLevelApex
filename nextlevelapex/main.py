#!/usr/bin/env python3
"""
NextLevelApex - Apex-level macOS setup orchestrator
===================================================

CLI entry point that wires up:
* Logging & configuration
* Task discovery/registration
* Orchestration with resumable state
"""

from __future__ import annotations

import json
import sys

# ── Standard library ────────────────────────────────────────────────────────
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any

# ── Third-party ─────────────────────────────────────────────────────────────
import typer
from typing_extensions import TypedDict

# Register tasks that live outside core (import side-effects)
import nextlevelapex.tasks.cloudflared  # noqa: F401

# ── Local imports ───────────────────────────────────────────────────────────
from nextlevelapex.core import config as config_loader
from nextlevelapex.core import state as state_tracker
from nextlevelapex.core.command import run_command  # noqa: F401
from nextlevelapex.core.diagnostics import generate_diagnostic_report
from nextlevelapex.core.logger import LoggerProxy, setup_logging
from nextlevelapex.core.registry import get_task_registry
from nextlevelapex.core.task import Severity, TaskResult

# ── Constants & default paths ───────────────────────────────────────────────
DEFAULT_CONFIG_PATH = Path.home() / ".config" / "nextlevelapex" / "config.json"
DEFAULT_STATE_PATH = Path.home() / ".local" / "state" / "nextlevelapex" / "state.json"


# ── Typed helpers ───────────────────────────────────────────────────────────
class TaskContext(TypedDict):
    """Runtime context passed to every task function."""

    config: dict[str, Any]
    dry_run: bool
    verbose: bool


TaskFunc = Callable[[TaskContext], TaskResult]

# ── Typer CLI app ───────────────────────────────────────────────────────────
app = typer.Typer(
    help="NextLevelApex - Apex-level macOS setup orchestrator.",
    add_completion=False,
)


# Small helper to route Severity -> logger method (supports HINT -> .info)
def _log_with_severity(log: LoggerProxy, sev: Severity, msg: str) -> None:
    method = getattr(sev, "log_method", None)
    name = method() if callable(method) else getattr(sev, "value", "info")
    # Map legacy/unknown values to .info
    if name not in {"debug", "info", "warning", "error"}:
        name = "info"
    getattr(log, name)(msg)


# ── CLI commands ────────────────────────────────────────────────────────────
@app.command()
def run(
    config_file: Annotated[
        Path,
        typer.Option(
            help="Path to JSON configuration file.",
            envvar="NLX_CONFIG_FILE",
        ),
    ] = DEFAULT_CONFIG_PATH,
    state_file: Annotated[
        Path,
        typer.Option(
            help="Path to state tracking file.",
            envvar="NLX_STATE_FILE",
        ),
    ] = DEFAULT_STATE_PATH,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", "-n", help="Print commands without executing.")
    ] = False,
    verbose: Annotated[
        bool, typer.Option("--verbose", "-v", help="Enable verbose (DEBUG) output.")
    ] = False,
    save_dryrun_state: Annotated[
        bool, typer.Option("--save-dryrun-state", help="Persist state file after dry-run.")
    ] = False,
    only: Annotated[
        list[str] | None,
        typer.Option(
            "--only",
            "-o",
            help=(
                "Run only the specified task(s). May be supplied multiple times - "
                "e.g.  -o 'Cloudflared DoH' -o 'Mise Globals'"
            ),
        ),
    ] = None,
) -> None:
    """
    Execute registered tasks.

    - By default everything is executed in the order tasks registered.
    - If `--only / -o` is supplied, only the named tasks are executed
      (in the same registration order). State-file skipping is ignored
      for those tasks so they always re-run.
    """
    # Import side-effect task modules (registration happens at import time)
    import nextlevelapex.tasks.brew
    import nextlevelapex.tasks.dev_tools
    import nextlevelapex.tasks.launch_agents
    import nextlevelapex.tasks.mise
    import nextlevelapex.tasks.network
    import nextlevelapex.tasks.ollama
    import nextlevelapex.tasks.optional
    import nextlevelapex.tasks.pihole  # noqa: F401

    # Prep logging + state
    config = config_loader.load_config(config_file)
    if not config:
        print("CRITICAL: Failed to load configuration - aborting.", file=sys.stderr)
        raise typer.Exit(code=1)

    setup_logging(config, verbose=verbose)
    log = LoggerProxy(__name__)

    state_data = state_tracker.load_state(state_file)

    log.debug("Configuration loaded: %s", json.dumps(config, indent=2))
    if verbose:
        print(
            "\n=== LOADED CONFIG ===\n",
            json.dumps(config, indent=2),
            "\n=====================\n",
        )

    # Common context
    ctx: TaskContext = {
        "config": config,
        "dry_run": dry_run,
        "verbose": verbose,
    }

    # Normalize --only
    only_set: set[str] = {name.strip() for name in only} if only else set()

    # Sanity: unknown task names
    unknown = only_set - set(get_task_registry())
    if unknown:
        typer.echo(f"ERROR: Unknown task(s) in --only: {', '.join(sorted(unknown))}", err=True)
        raise typer.Exit(1)

    overall_success = True
    summary: list[TaskResult] = []

    for task_name, handler in get_task_registry().items():
        # Skip tasks not requested via --only
        if only_set and task_name not in only_set:
            log.info("Skipping %s - not selected via --only.", task_name)
            continue

        # Respect state only when NOT forced by --only
        already_done = state_tracker.is_section_complete(task_name, state_data)  # type: ignore[attr-defined]
        if already_done and not only_set:
            log.info("Skipping %s - already marked complete in state.", task_name)
            summary.append(
                TaskResult(
                    name=task_name,
                    success=True,
                    changed=False,
                    messages=[(Severity.INFO, "Task skipped - already completed in previous run.")],
                )
            )
            continue

        # Run task
        log.info("--- Running task: %s ---", task_name)
        try:
            result: TaskResult = handler(ctx)
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            log.exception("Task %s crashed: %s", task_name, exc)
            result = TaskResult(
                name=task_name,
                success=False,
                changed=False,
                messages=[(Severity.ERROR, str(exc))],
            )

        # Emit messages with Severity-aware routing
        if getattr(result, "messages", None):
            for lvl, msg in result.messages:
                _log_with_severity(log, lvl, f"{result.name}: {msg}")

        summary.append(result)

        # Failure -> abort
        if not result.success:
            log.error("Task %s FAILED - aborting further execution.", task_name)
            diagnostics = generate_diagnostic_report(
                failed_task_name=task_name,
                error_info=str(result.messages),
                context=ctx,
            )

            diagnostic_path = Path.home() / "Library/Logs/NextLevelApex/diagnostics.json"
            diagnostic_path.parent.mkdir(parents=True, exist_ok=True)
            diagnostic_path.write_text(json.dumps(diagnostics, indent=2))
            log.info("Diagnostic report written to %s", diagnostic_path)
            overall_success = False
            break

        # Persist success in state unless we’re in dry-run
        if result.success:
            state_tracker.mark_section_complete(task_name, state_data)

        if result.changed:
            log.info("Task %s made changes", task_name)

    # Summary
    _print_summary(summary, overall_success, log)

    if overall_success:
        state_tracker.mark_run_success(state_data)  # type: ignore[attr-defined]
    else:
        failed_task = next((r.name for r in summary if not r.success), "UNKNOWN")
        state_tracker.mark_run_failed(failed_task, state_data)  # type: ignore[attr-defined]

    if not dry_run or save_dryrun_state:
        state_tracker.save_state(state_data, state_file, dry_run=False)
    else:
        log.info("Skipping state file write because this is a dry run.")

    raise typer.Exit(code=0 if overall_success else 1)


# ── Helpers ────────────────────────────────────────────────────────────────
def _print_summary(results: list[TaskResult], ok: bool, log: LoggerProxy) -> None:
    """Pretty-print a one line summary per task."""
    log.info("================================================================")
    for res in results:
        status = "OK " if res.success else "FAIL"
        changed = " (changed)" if res.changed else ""
        log.info("* %-20s : %s%s", res.name, status, changed)
    log.info("================================================================")
    log.info("Overall result: %s", "SUCCESS" if ok else "FAILURE")


@app.command(name="generate-config")
def generate_config_command(
    force: Annotated[bool, typer.Option("--force", help="Overwrite existing config file.")] = False,
) -> None:
    """
    Generate a default config file at ~/.config/nextlevelapex/config.json.
    """
    cfg_path = DEFAULT_CONFIG_PATH
    log = LoggerProxy(__name__)
    log.info("Generating default config at %s", cfg_path)
    if cfg_path.exists() and not force:
        log.error("Config already exists - use --force to overwrite.")
        raise typer.Exit(code=1)

    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    ok = config_loader.generate_default_config(cfg_path)
    if ok:
        typer.echo(f"Default config written to {cfg_path}")
    else:
        typer.echo("Failed to create default config", err=True)
        raise typer.Exit(code=1)


@app.command(name="diagnose")
def diagnose_command(
    task: Annotated[str, typer.Option(help="Name of the failed task")],
    error: Annotated[str, typer.Option(help="Error message or summary")],
    config_file: Annotated[
        Path,
        typer.Option(help="Path to JSON configuration file.", envvar="NLX_CONFIG_FILE"),
    ] = DEFAULT_CONFIG_PATH,
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Optional path to write the diagnostic JSON report."),
    ] = None,
    verbose: Annotated[bool, typer.Option("--verbose", "-v")] = False,
) -> None:
    """
    Run a standalone diagnostic report for a failed task.
    """
    setup_logging({}, verbose=verbose)
    log = LoggerProxy(__name__)

    config = config_loader.load_config(config_file)
    if not config:
        log.error("Failed to load config file.")
        raise typer.Exit(code=1)

    context: TaskContext = {
        "config": config,
        "dry_run": True,  # always dry-run for diagnostics
        "verbose": verbose,
    }

    report = generate_diagnostic_report(task, error, context)
    json_str = json.dumps(report, indent=2)

    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json_str)
        typer.echo(f"Diagnostic report written to {output}")
    else:
        typer.echo(json_str)


@app.command(name="doctor-dns")
def doctor_dns() -> None:
    """
    Run in-process DNS doctor checks and print a quick human-friendly summary.
    """
    setup_logging({}, verbose=False)
    log = LoggerProxy(__name__)
    try:
        # Lazy import to avoid any import cycles
        from nextlevelapex.tasks.dns_helpers import run_all_dns_checks
    except Exception as exc:  # pragma: no cover - defensive
        log.error("Failed to import DNS helpers: %s", exc)
        raise typer.Exit(code=1) from None

    results = run_all_dns_checks()
    ok = all(r.success for r in results)
    for r in results:
        log.info("[%s] %s", "OK" if r.success else "FAIL", r.name)
        for sev, msg in getattr(r, "messages", []):
            _log_with_severity(log, sev, f"  - {msg}")

    raise typer.Exit(code=0 if ok else 2)


# ── Main guard ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app()
