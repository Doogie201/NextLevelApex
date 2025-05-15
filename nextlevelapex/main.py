#!/usr/bin/env python3
"""
NextLevelApex – Apex‑level macOS setup orchestrator
===================================================

This is the CLI entry‑point.  It wires up:

* Logging & configuration
* Task discovery/registration
* Orchestration with resumable state
"""

from __future__ import annotations

# ── Standard library ────────────────────────────────────────────────────────
import json
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional

# ── Third-party ─────────────────────────────────────────────────────────────
import typer
from typing_extensions import Annotated, TypedDict

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

    config: Dict
    dry_run: bool
    verbose: bool


TaskFunc = Callable[[TaskContext], TaskResult]

# ── Typer CLI app ───────────────────────────────────────────────────────────
app = typer.Typer(
    help="NextLevelApex – Apex‑level macOS setup orchestrator.",
    add_completion=False,
)


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
        bool,
        typer.Option("--dry-run", "-n", help="Print commands without executing."),
    ] = False,
    verbose: Annotated[
        bool,
        typer.Option("--verbose", "-v", help="Enable verbose (DEBUG) output."),
    ] = False,
    save_dryrun_state: Annotated[
        bool,
        typer.Option("--save-dryrun-state", help="Persist state file after dry-run."),
    ] = False,
):
    """
    Execute all registered tasks in order of registration.
    """
    import nextlevelapex.tasks.brew
    import nextlevelapex.tasks.dev_tools
    import nextlevelapex.tasks.launch_agents
    import nextlevelapex.tasks.mise
    import nextlevelapex.tasks.network
    import nextlevelapex.tasks.ollama
    import nextlevelapex.tasks.optional

    # Load configuration first
    config = config_loader.load_config(config_file)
    if not config:
        print("CRITICAL: Failed to load configuration – aborting.", file=sys.stderr)
        raise typer.Exit(code=1)

    # Setup logging
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

    # Build common context
    ctx: TaskContext = {
        "config": config,
        "dry_run": dry_run,
        "verbose": verbose,
    }

    # Run tasks --------------------------------------------------------------
    overall_success = True
    summary: List[TaskResult] = []

    for task_name, handler in get_task_registry().items():
        if state_tracker.is_section_complete(task_name, state_data):
            log.info("Skipping %s – already marked complete in state.", task_name)
            summary.append(
                TaskResult(
                    name=task_name,
                    success=True,
                    changed=False,
                    messages=[
                        (
                            Severity.INFO,
                            "Task skipped – already completed in previous run.",
                        )
                    ],
                )
            )
            continue

        log.info("─── Running task: %s ───", task_name)
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

        if hasattr(result, "messages"):
            for lvl, msg in result.messages:
                getattr(log, lvl.value)(f"{result.name}: {msg}")

        summary.append(result)

        if not result.success:
            log.error("Task %s FAILED – aborting further execution.", task_name)
            diagnostics = generate_diagnostic_report(
                failed_task_name=task_name,
                error_info=str(result.messages),
                context=ctx,
            )

            diagnostic_path = (
                Path.home() / "Library/Logs/NextLevelApex/diagnostics.json"
            )
            diagnostic_path.write_text(json.dumps(diagnostics, indent=2))
            log.info("Diagnostic report written to %s", diagnostic_path)
            overall_success = False
            break

        if result.success:
            state_tracker.mark_section_complete(task_name, state_data)

        if result.changed:
            log.info("Task %s made changes", task_name)

    # Summary ---------------------------------------------------------------
    _print_summary(summary, overall_success, log)

    if overall_success:
        state_tracker.mark_run_success(state_data)
    else:
        failed_task = next((r.name for r in summary if not r.success), "UNKNOWN")
        state_tracker.mark_run_failed(failed_task, state_data)

    if not dry_run or save_dryrun_state:
        state_tracker.save_state(state_data, state_file, dry_run=False)
    else:
        log.info("Skipping state file write because this is a dry run.")

    raise typer.Exit(code=0 if overall_success else 1)


def _print_summary(results: List[TaskResult], ok: bool, log: LoggerProxy) -> None:
    """Pretty print a one‑line summary per task."""
    log.info("================================================================")
    for res in results:
        status = "OK " if res.success else "FAIL"
        changed = " (changed)" if res.changed else ""
        log.info("• %-15s : %s%s", res.name, status, changed)
    log.info("================================================================")
    log.info("Overall result: %s", "SUCCESS" if ok else "FAILURE")


@app.command(name="generate-config")
def generate_config_command(
    force: Annotated[
        bool,
        typer.Option("--force", help="Overwrite existing config file."),
    ] = False,
):
    """
    Generate a default config file at
    `~/.config/nextlevelapex/config.json`.
    """
    cfg_path = DEFAULT_CONFIG_PATH
    log = LoggerProxy(__name__)
    log.info("Generating default config at %s", cfg_path)
    if cfg_path.exists() and not force:
        log.error("Config already exists – use --force to overwrite.")
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
        typer.Option(
            help="Path to JSON configuration file.",
            envvar="NLX_CONFIG_FILE",
        ),
    ] = DEFAULT_CONFIG_PATH,
    output: Annotated[
        Optional[Path],
        typer.Option(
            "--output",
            "-o",
            help="Optional path to write the diagnostic JSON report.",
        ),
    ] = None,
    verbose: Annotated[bool, typer.Option("--verbose", "-v")] = False,
):
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
        output.write_text(json_str)
        typer.echo(f"Diagnostic report written to {output}")
    else:
        typer.echo(json_str)


# ── Main guard ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app()
