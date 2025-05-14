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
import logging
import sys
from pathlib import Path
from typing import Callable, Dict, List

# ── Third-party ─────────────────────────────────────────────────────────────
import typer
from typing_extensions import Annotated, TypedDict

# ── Local imports ───────────────────────────────────────────────────────────
from nextlevelapex.core import config as config_loader
from nextlevelapex.core.command import run_command  # noqa: F401
from nextlevelapex.core.registry import get_task_registry
from nextlevelapex.core.task import Severity, TaskResult

# ── Logging setup ───────────────────────────────────────────────────────────
LOG_FORMAT = "%(asctime)s [%(levelname)-8s] %(name)-18s: %(message)s"
logging.basicConfig(
    level=logging.INFO,
    format=LOG_FORMAT,
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

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
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", "-n", help="Print commands without executing."),
    ] = False,
    verbose: Annotated[
        bool,
        typer.Option("--verbose", "-v", help="Enable verbose (DEBUG) output."),
    ] = False,
):
    """
    Execute all registered tasks in order of registration.
    """
    import nextlevelapex.tasks.brew
    import nextlevelapex.tasks.dev_tools
    import nextlevelapex.tasks.launch_agents
    import nextlevelapex.tasks.mise
    import nextlevelapex.tasks.ollama

    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)
        log.debug("Verbose logging enabled")

    # Load configuration -----------------------------------------------------
    config = config_loader.load_config(config_file)
    if not config:
        log.critical("Failed to load configuration – aborting.")
        raise typer.Exit(code=1)
    log.debug("Configuration loaded: %s", json.dumps(config, indent=2))
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

        # Emit every message from the task
        if hasattr(result, "messages"):
            for lvl, msg in result.messages:
                getattr(log, lvl.value)(f"{result.name}: {msg}")

        summary.append(result)

        if not result.success:
            log.error("Task %s FAILED – aborting further execution.", task_name)
            overall_success = False
            break

        if result.changed:
            log.info("Task %s made changes", task_name)

    # Summary ---------------------------------------------------------------
    _print_summary(summary, overall_success)
    raise typer.Exit(code=0 if overall_success else 1)


def _print_summary(results: List[TaskResult], ok: bool) -> None:
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


# ── Main guard ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app()
