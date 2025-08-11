# mypy: ignore-errors
# nextlevelapex/main.py

import importlib
import sys
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

import typer

# For reporting, to be implemented next
from nextlevelapex.core.report import generate_report

# Import core state and base_task utilities
from nextlevelapex.core.state import (
    file_hash_changed,
    get_task_health_trend,
    load_state,
    mark_section_complete,
    mark_section_failed,
    save_state,
    update_file_hashes,
    update_task_health,
)
from nextlevelapex.tasks.base_task import BaseTask, get_registered_tasks

# Generate report(s)
html_path, md_path = generate_report(state, REPORTS_DIR, as_html=html_report, as_md=markdown_report)
if html_path:
    print(f"[REPORT] HTML report written: {html_path}")
if md_path:
    print(f"[REPORT] Markdown report written: {md_path}")

APP_ROOT = Path(__file__).parent
TASKS_DIR = APP_ROOT / "tasks"
STATE_PATH = Path.home() / ".local" / "state" / "nextlevelapex" / "state.json"
REPORTS_DIR = APP_ROOT.parent / "reports"

app = typer.Typer(help="NextLevelApex Orchestrator")


def discover_tasks() -> dict[str, Callable]:
    """
    Dynamically import and register all tasks in tasks/ directory.
    Handles both BaseTask subclasses and function-based tasks.
    Returns dict: { task_name: callable }
    """
    tasks = {}
    sys.path.insert(0, str(TASKS_DIR.parent))  # Ensure import path

    for file in TASKS_DIR.glob("*.py"):
        if file.name.startswith("__"):
            continue
        module_name = f"nextlevelapex.tasks.{file.stem}"
        try:
            module = importlib.import_module(module_name)
        except Exception as e:
            print(f"[ERROR] Could not import {module_name}: {e}")
            continue

        # Find all BaseTask subclasses
        for attr in dir(module):
            obj = getattr(module, attr)
            if isinstance(obj, type) and issubclass(obj, BaseTask) and obj is not BaseTask:
                task_name = getattr(obj, "name", obj.__name__)
                tasks[task_name] = obj  # Note: store class, instantiate later

        # Function-based tasks via @task decorator registry
        if hasattr(module, "TASK_REGISTRY"):
            tasks.update(module.TASK_REGISTRY)

    # Also add function tasks registered globally (from base_task.py registry)
    tasks.update(get_registered_tasks())
    return tasks


def discover_files_for_hashing() -> list[Path]:
    """
    Returns all config/manifest files to hash for drift detection.
    """
    files = [
        Path("/Users/marcussmith/Projects/NextLevelApex/docker/orchestrate.sh"),
        Path(
            "/Users/marcussmith/Projects/NextLevelApex/docker/unbound/dockerfiles/cloudflared-dig.Dockerfile"
        ),
        Path("/Users/marcussmith/Projects/NextLevelApex/docker/unbound/state/root.hints"),
        Path("/Users/marcussmith/Projects/NextLevelApex/docker/unbound/state/root.key"),
        Path("/Users/marcussmith/Projects/NextLevelApex/docker/unbound/state/unbound.conf"),
        Path("/Users/marcussmith/Projects/NextLevelApex/docker/unbound/docker-compose.yml"),
        Path("/Users/marcussmith/Projects/NextLevelApex/docker/unbound/Dockerfile"),
        # Add other config/manifest files as desired
    ]
    # Optionally, include all .py files in tasks/core
    files += list((APP_ROOT / "core").glob("*.py"))
    files += list((APP_ROOT / "tasks").glob("*.py"))
    return files


def ensure_task_state(state: dict[str, Any], task_names: list[str]) -> None:
    """
    Ensures all discovered tasks are present in state (task_status, health_history, etc.)
    """
    for t in task_names:
        if t not in state["task_status"]:
            state["task_status"][t] = {"status": "PENDING", "last_update": None}
        if t not in state["health_history"]:
            state["health_history"][t] = []
    # Remove stale tasks (optional)
    known = set(task_names)
    for old in list(state["task_status"].keys()):
        if old not in known:
            del state["task_status"][old]
    for old in list(state["health_history"].keys()):
        if old not in known:
            del state["health_history"][old]


def run_task(task_name: str, task_callable, context: dict[str, Any]) -> dict[str, Any]:
    """
    Runs a discovered task, class or function-based.
    Returns standardized result dict.
    """
    if isinstance(task_callable, type) and issubclass(task_callable, BaseTask):
        result = task_callable().run(context)
    elif callable(task_callable):
        result = task_callable(context)
    else:
        raise RuntimeError(f"Cannot run task: {task_name}")
    return result


@app.command()
def main(
    mode: str = typer.Option("run", help="run|test|stress|security"),
    html_report: bool = typer.Option(True, help="Generate HTML report"),
    markdown_report: bool = typer.Option(True, help="Generate Markdown report"),
    dry_run: bool = typer.Option(False, help="Dry run only, no changes made."),
):
    # 1. Load state
    state = load_state(STATE_PATH)
    now = datetime.utcnow().isoformat()

    # 2. Discover tasks
    discovered_tasks = discover_tasks()
    task_names = list(discovered_tasks.keys())
    ensure_task_state(state, task_names)

    # 3. Update config/manifest file hashes for drift detection
    files = discover_files_for_hashing()
    prev_hashes = state.get("file_hashes", {}).copy()
    update_file_hashes(state, files)

    # 4. Run tasks as needed
    for name, task_callable in discovered_tasks.items():
        print(f"\n[Task: {name}]")
        # Skip if already healthy & no config drift
        hash_drift = any(file_hash_changed(state, f) for f in files)
        last_status = state["task_status"].get(name, {}).get("status")
        needs_run = (last_status != "PASS") or hash_drift or mode in ("test", "stress", "security")
        if not needs_run:
            print("  [SKIP] No drift or failure, healthy.")
            continue

        print(f"  [RUN] Executing task ({'DRY RUN' if dry_run else 'real'})")
        context = {
            "mode": mode,
            "dry_run": dry_run,
            "state": state,
            "now": now,
        }
        try:
            result = run_task(name, task_callable, context)
            status = result.get("status", "UNKNOWN")
            update_task_health(name, status, result.get("details"), state)
            if status == "PASS":
                mark_section_complete(name, state)
                print("    [PASS]")
            else:
                mark_section_failed(name, state)
                print("    [FAIL/WARN]")
        except Exception as e:
            mark_section_failed(name, state)
            update_task_health(name, "FAIL", {"error": str(e)}, state)
            print(f"    [ERROR] {e}")

    # 5. Save state
    save_state(state, STATE_PATH, dry_run=dry_run)

    # 6. Generate report(s)
    # html_path, md_path = generate_report(state, REPORTS_DIR, as_html=html_report, as_md=markdown_report)
    # if html_path:
    #     print(f"[REPORT] HTML report written: {html_path}")
    # if md_path:
    #     print(f"[REPORT] Markdown report written: {md_path}")

    print("\n[Done] State updated.")
    print("Current health summary:")
    for t in task_names:
        status = state["task_status"][t]["status"]
        last_healthy = state["task_status"][t].get("last_healthy", "--")
        print(f"  {t:20}: {status:8} (last healthy: {last_healthy})")


@app.command("diagnose")
def diagnose(
    task_name: str = typer.Argument(..., help="Task to diagnose"),
    autofix: bool = typer.Option(False, help="Try recommended fix automatically (if possible)"),
):
    state = load_state(STATE_PATH)
    discovered_tasks = discover_tasks()
    if task_name not in discovered_tasks:
        typer.secho(f"[ERROR] Task '{task_name}' not found.", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    typer.secho(f"\n=== Deep Diagnose: {task_name} ===", fg=typer.colors.BLUE, bold=True)
    task_callable = discovered_tasks[task_name]
    context = {
        "mode": "diagnose",
        "state": state,
        "now": datetime.utcnow().isoformat(),
        "autofix": autofix,
    }
    result = None
    try:
        result = run_task(task_name, task_callable, context)
    except Exception as e:
        import traceback as tb

        result = {
            "status": "ERROR",
            "explanation": str(e),
            "traceback": tb.format_exc(),
        }
    status = result.get("status", "UNKNOWN")
    fg = typer.colors.GREEN if status == "PASS" else typer.colors.RED
    typer.secho(f"Status: {status}", fg=fg, bold=True)
    typer.echo(f"\nDetails: {result.get('details')}")
    typer.echo(f"Explanation: {result.get('explanation')}")
    typer.echo(f"Recommendation: {result.get('recommendation')}")
    if result.get("traceback"):
        typer.secho("Traceback:", fg=typer.colors.RED)
        typer.echo(result["traceback"])
    typer.echo(f"Inputs: {result.get('inputs')}")
    typer.echo(f"Context: {result.get('context')}")

    # Show last 3 health runs
    from nextlevelapex.core.state import get_task_health_trend

    history = get_task_health_trend(task_name, state)
    typer.echo("\nRecent health history:")
    for entry in history[-3:]:
        typer.echo(f"{entry['timestamp']}: {entry['status']} {entry.get('explanation', '')}")

    # If autofix is implemented, show option
    if autofix and "recommendation" in result and result["recommendation"]:
        # Implement autofix logic here (could call a shell command or patch config)
        typer.secho("Autofix attempted (TODO: Implement logic)", fg=typer.colors.YELLOW)


@app.command("list-tasks")
def list_tasks(
    filter: str = typer.Option(None, help="Filter by status: pass, fail, warn, pending"),
):
    """
    List all discovered tasks with their status and last update.
    """
    state = load_state(STATE_PATH)
    tasks = state.get("task_status", {})
    typer.echo(f"{'Task':22} | {'Status':8} | {'Last Update':20}")
    typer.echo("-" * 56)
    for name, info in tasks.items():
        status = info.get("status", "UNKNOWN")
        if filter and status.lower() != filter.lower():
            continue
        last_update = info.get("last_update", "--")
        typer.echo(f"{name:22} | {status:8} | {last_update:20}")


@app.command("task-info")
def task_info(task_name: str = typer.Argument(..., help="Name of the task/section")):
    """
    Show detailed info and docstring for a task, including its recent history.
    """
    discovered = discover_tasks()
    if task_name not in discovered:
        typer.secho(f"Task '{task_name}' not found.", fg=typer.colors.RED)
        raise typer.Exit(code=1)
    obj = discovered[task_name]
    doc = obj.__doc__ if hasattr(obj, "__doc__") else ""
    typer.secho(f"Task: {task_name}\n", fg=typer.colors.BLUE, bold=True)
    if doc:
        typer.echo(f"Docstring: {doc.strip()}\n")
    state = load_state(STATE_PATH)
    trend = get_task_health_trend(task_name, state)
    typer.echo("Recent history:")
    for entry in trend[-5:]:
        typer.echo(f"  {entry['timestamp']}: {entry['status']} {entry.get('explanation', '')}")


@app.command("report")
def generate_report_cli(
    html: bool = typer.Option(True, help="Generate HTML report"),
    markdown: bool = typer.Option(True, help="Generate Markdown report"),
):
    """
    Generate Markdown/HTML summary report for NextLevelApex.
    """
    from nextlevelapex.core.report import (  # You’ll need to finish report.py!
        generate_report,
    )

    state = load_state(STATE_PATH)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    html_path, md_path = generate_report(state, REPORTS_DIR, as_html=html, as_md=markdown)
    if html_path:
        typer.echo(f"[REPORT] HTML: {html_path}")
    if md_path:
        typer.echo(f"[REPORT] Markdown: {md_path}")


@app.command("reset-state")
def reset_state(
    only_failed: bool = typer.Option(False, help="Only reset failed sections"),
    backup: bool = typer.Option(True, help="Backup old state file"),
):
    """
    Reset orchestrator state (all or just failed sections), with optional backup.
    """
    import shutil

    if STATE_PATH.exists() and backup:
        bkup = STATE_PATH.parent / f"state.backup.{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        shutil.copy(STATE_PATH, bkup)
        typer.echo(f"State backup at {bkup}")
    state = load_state(STATE_PATH)
    if only_failed:
        for s in state.get("failed_sections", []):
            state["task_status"][s] = {"status": "PENDING", "last_update": None}
        state["failed_sections"] = []
        typer.echo("Reset only failed sections.")
    else:
        state.clear()
        state.update(
            {
                "version": "2.0",
                "last_run_status": "UNKNOWN",
                "completed_sections": [],
                "failed_sections": [],
                "task_status": {},
                "file_hashes": {},
                "health_history": {},
                "service_versions": {},
                "last_report_path": None,
            }
        )
        typer.echo("Reset full orchestrator state.")
    save_state(state, STATE_PATH)


@app.command("history")
def show_history(
    task: str = typer.Option(None, help="Task to show history for (all if blank)"),
):
    """
    Show health/check history for a task or for all tasks.
    """
    state = load_state(STATE_PATH)
    if task:
        history = get_task_health_trend(task, state)
        typer.secho(f"History for {task}:", fg=typer.colors.BLUE, bold=True)
        for entry in history:
            typer.echo(f"{entry['timestamp']}: {entry['status']} {entry.get('explanation', '')}")
    else:
        for t, hist in state.get("health_history", {}).items():
            typer.secho(f"\n{t}:", fg=typer.colors.BLUE, bold=True)
            for entry in hist:
                typer.echo(
                    f"  {entry['timestamp']}: {entry['status']} {entry.get('explanation', '')}"
                )


@app.command("auto-fix")
def auto_fix():
    """
    Attempt to fix failed tasks automatically if recommendations exist.
    """
    state = load_state(STATE_PATH)
    discovered = discover_tasks()
    fixes = []
    for t in state.get("failed_sections", []):
        task_callable = discovered.get(t)
        if not task_callable:
            continue
        typer.secho(f"Auto-fixing: {t}", fg=typer.colors.YELLOW, bold=True)
        context = {
            "mode": "autofix",
            "state": state,
            "now": datetime.utcnow().isoformat(),
            "autofix": True,
        }
        try:
            result = run_task(t, task_callable, context)
            rec = result.get("recommendation")
            if rec:
                typer.secho(f"  Recommendation: {rec}", fg=typer.colors.GREEN)
                # Optionally, implement shell execution here if safe/approved!
                fixes.append((t, rec))
            else:
                typer.secho(f"  No autofix available for {t}.", fg=typer.colors.RED)
        except Exception as e:
            typer.secho(f"  Error while fixing {t}: {e}", fg=typer.colors.RED)
    if not fixes:
        typer.secho("No auto-fixes performed.", fg=typer.colors.BLUE)


@app.command("export-state")
def export_state(
    fmt: str = typer.Option("json", help="Export format: json, yaml, csv"),
):
    """
    Export orchestrator state as JSON, YAML, or CSV.
    """
    state = load_state(STATE_PATH)
    path = REPORTS_DIR / f"state-export-{datetime.now().strftime('%Y%m%d-%H%M%S')}.{fmt}"
    if fmt == "json":
        import json

        with path.open("w") as f:
            json.dump(state, f, indent=2)
    elif fmt == "yaml":
        import yaml

        with path.open("w") as f:
            yaml.dump(state, f)
    elif fmt == "csv":
        import csv

        # Flatten state to rows if possible (else error)
        keys = sorted(state.keys())
        with path.open("w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(keys)
            writer.writerow([str(state[k]) for k in keys])
    else:
        typer.secho("Unknown format", fg=typer.colors.RED)
        raise typer.Exit(code=1)
    typer.echo(f"Exported state to {path}")


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


if __name__ == "__main__":
    app.command()(main)
    app()
