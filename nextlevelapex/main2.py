# mypy: ignore-errors
# nextlevelapex/main.py

import importlib
import subprocess
import sys
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Callable, Dict, List, Optional, Type, Union

import typer

from nextlevelapex.core.config import DEFAULT_CONFIG_PATH, generate_default_config, load_config
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import get_task_registry

# Import core state and base_task utilities
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
from nextlevelapex.tasks.base_task import BaseTask, RemediationAction, RemediationPlan

# Type Alias for State definitions to improve readability
StateDict = Dict[str, Any]

APP_ROOT = Path(__file__).parent
TASKS_DIR = APP_ROOT / "tasks"
STATE_PATH = Path.home() / ".local" / "state" / "nextlevelapex" / "state.json"
REPORTS_DIR = APP_ROOT.parent / "reports"

app = typer.Typer(help="NextLevelApex Orchestrator")


# Explicit registry of allowed task modules to prevent arbitrary code execution (CWE-94)
ALLOWED_MODULES = [
    "brew",
    "cloudflared",
    "dev_tools",
    "dns_helpers",
    "dns_sanity",
    "dns_stack",
    "dummy_healing_task",
    "launch_agents",
    "mise",
    "network",
    "ollama",
    "optional",
    "pihole",
    "security",
    "system",
]


def discover_tasks() -> Dict[str, Union[Type[BaseTask], Callable]]:
    """
    Dynamically import and register explicitly allowed tasks in tasks/ directory.
    Handles both BaseTask subclasses and function-based tasks.
    Returns dict: { task_name: callable }
    """
    tasks = {}
    sys.path.insert(0, str(TASKS_DIR.parent))  # Ensure import path

    for module_name in ALLOWED_MODULES:
        full_module_name = f"nextlevelapex.tasks.{module_name}"
        try:
            module = importlib.import_module(full_module_name)
        except Exception as e:
            print(f"[ERROR] Could not import {full_module_name}: {e}")
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

    # Also add function tasks registered globally (from core.registry)
    tasks.update(get_task_registry())
    return tasks


def discover_files_for_hashing() -> List[Path]:
    """
    Returns all config/manifest files to hash for drift detection.
    Dynamically resolved from APP_ROOT to avoid hardcoded paths.
    """
    docker_dir = APP_ROOT.parent / "docker"
    unbound_dir = docker_dir / "unbound"
    files = [
        docker_dir / "orchestrate.sh",
        unbound_dir / "dockerfiles" / "cloudflared-dig.Dockerfile",
        unbound_dir / "state" / "root.hints",
        unbound_dir / "state" / "root.key",
        unbound_dir / "state" / "unbound.conf",
        unbound_dir / "docker-compose.yml",
        unbound_dir / "Dockerfile",
        # Add other config/manifest files as desired
    ]
    # Filter only existing files to avoid errors
    existing_files = [f for f in files if f.exists()]

    # Optionally, include all .py files in tasks/core
    existing_files += list((APP_ROOT / "core").glob("*.py"))
    existing_files += list((APP_ROOT / "tasks").glob("*.py"))
    return existing_files


def ensure_task_state(state: StateDict, task_names: List[str]) -> None:
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


def run_task(
    task_name: str, task_callable: Union[Type[BaseTask], Callable], context: StateDict
) -> StateDict:
    """
    Runs a discovered task, class or function-based.
    Returns standardized result dict.
    """
    if isinstance(task_callable, type) and issubclass(task_callable, BaseTask):
        result = task_callable().run(context)
    elif callable(task_callable):
        raw_result = task_callable(context)
        if hasattr(raw_result, "success"):
            status = "PASS" if raw_result.success else "FAIL"
            msgs = getattr(raw_result, "messages", [])

            # Format messages if it's a list of tuples like (Severity, str)
            if msgs and isinstance(msgs, list) and isinstance(msgs[0], tuple):
                details = "\n".join(
                    f"[{m[0].name}] {m[1]}" if hasattr(m[0], 'name') else str(m) for m in msgs
                )
            else:
                details = str(msgs) if msgs else "No details"

            result = {"status": status, "details": details}

            # Carry over arbitrary attributes like remediation_plan if they somehow exist on the tuple
            if hasattr(raw_result, "remediation_plan"):
                result["remediation_plan"] = raw_result.remediation_plan
        else:
            result = raw_result
    else:
        raise RuntimeError(f"Cannot run task: {task_name}")
    return result


def execute_remediation(action: RemediationAction, dry_run: bool = False) -> bool:
    """
    Executes a specific remediation action safely.
    Returns True if successful, False otherwise.
    """
    action_type = action.get("action_type")
    payload = action.get("payload", "")
    req_elevated = action.get("requires_elevated", False)

    if action_type == "shell_cmd":
        import shlex

        cmd_list = shlex.split(payload)
        if req_elevated:
            cmd_list.insert(0, "sudo")

        cmd_str = " ".join(cmd_list)
        if dry_run:
            typer.secho(f"    DRY RUN: Would execute `{cmd_str}`", fg=typer.colors.YELLOW)
            return True

        try:
            # Execute with a 30 second timeout to prevent hanging the orchestrator
            result = subprocess.run(
                cmd_list, check=True, text=True, capture_output=True, timeout=30
            )
            if result.stdout:
                typer.echo(f"      STDOUT: {result.stdout.strip()}")
            return True
        except subprocess.TimeoutExpired:
            typer.secho("    ACTION TIMED OUT AFTER 30s.", fg=typer.colors.RED)
            return False
        except subprocess.CalledProcessError as e:
            typer.secho(
                f"    ACTION FAILED (Exit {e.returncode}). STDERR: {e.stderr.strip()}",
                fg=typer.colors.RED,
            )
            return False

    elif action_type == "restart_service":
        import re

        if not re.match(r"^[a-zA-Z0-9_\-]+$", payload):
            typer.secho(
                f"    FAILED TO RESTART SERVICE: Invalid service name '{payload}'",
                fg=typer.colors.RED,
            )
            return False

        if sys.platform != "darwin":
            cmd_list = ["sudo", "systemctl", "restart", payload]
        else:
            cmd_list = ["brew", "services", "restart", payload]

        if dry_run:
            typer.secho(f"    DRY RUN: Would restart service `{payload}`", fg=typer.colors.YELLOW)
            return True

        try:
            subprocess.run(cmd_list, check=True, text=True, capture_output=True, timeout=15)
            typer.echo(f"      Restarted service: {payload}")
            return True
        except subprocess.CalledProcessError:
            typer.secho(f"    FAILED TO RESTART SERVICE: {payload}", fg=typer.colors.RED)
            return False

    elif action_type == "manual":
        typer.secho(f"    MANUAL INTERVENTION REQUIRED: {payload}", fg=typer.colors.MAGENTA)
        return False

    else:
        typer.secho(f"    Unknown action type passed: {action_type}", fg=typer.colors.RED)
        return False


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    mode: str = typer.Option("run", help="run|test|stress|security"),
    task: Optional[List[str]] = typer.Option(
        None,
        "--task",
        "-t",
        help="Run specific tasks (substring match). Skips reports by default when used.",
    ),
    html_report: bool = typer.Option(
        True, help="Generate HTML report. Overridden if --task or --no-reports is specified."
    ),
    markdown_report: bool = typer.Option(
        True, help="Generate Markdown report. Overridden if --task or --no-reports is specified."
    ),
    no_reports: bool = typer.Option(
        False, "--no-reports", help="Skip all report generation globally."
    ),
    dry_run: bool = typer.Option(False, help="Dry run only, no changes made."),
):
    # Skip main execution if a sub-command (like diagnose or list-tasks) is called
    if ctx.invoked_subcommand:
        return

    # 1. Load state and config
    state = load_state(STATE_PATH)
    config = load_config()
    now = datetime.now().isoformat()

    # 2. Discover tasks
    discovered_tasks = discover_tasks()

    # 2b. Filter tasks if --task is provided
    if task:
        # User specified at least one filter
        filtered = {}
        target_lower_list = [t.lower() for t in task]
        for name, task_callable in discovered_tasks.items():
            name_lower = name.lower()
            if any(t in name_lower for t in target_lower_list):
                filtered[name] = task_callable

        if not filtered:
            typer.secho(f"No tasks matched the filters: {task}", fg=typer.colors.RED)
            raise typer.Exit(code=1)

        typer.secho(
            f"Filtered to {len(filtered)} tasks (from {len(discovered_tasks)}): {list(filtered.keys())}",
            fg=typer.colors.CYAN,
        )
        discovered_tasks = filtered

        # Override report generation so we don't bloat the directory on selective runs
        if not no_reports:
            typer.secho(
                "Disabling HTML/Markdown report generation for selective task execution.",
                fg=typer.colors.YELLOW,
            )
            html_report = False
            markdown_report = False

    task_names = list(discovered_tasks.keys())

    # Optional Sudo Consolidation: Ping for sudo upfront purely to cache it for `networksetup` / etc
    print("Ensuring sudo privileges are active for this run...")
    import os
    import pty

    # We use pty.spawn to trick sudo into thinking it's running directly in a terminal
    # This ensures the password prompt is displayed even when nested under poetry run or Typer
    try:
        ret = pty.spawn(["sudo", "-v"])
        if ret != 0:
            typer.secho("Sudo authorization failed or was cancelled.", fg=typer.colors.RED)
            raise typer.Exit(code=1)
    except Exception as e:
        typer.secho(f"Exception during sudo auth: {e}", fg=typer.colors.RED)
        raise typer.Exit(code=1)

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
            "config": config,
            "now": now,
        }
        try:
            result = run_task(name, task_callable, context)
            status = result.get("status", "UNKNOWN")

            # Ensure details is a dict before passing to update_task_health
            details_raw = result.get("details")
            details_dict = {"message": str(details_raw)} if details_raw is not None else None

            update_task_health(name, status, details_dict, state)
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
    if no_reports:
        html_report = False
        markdown_report = False

    if html_report or markdown_report:
        h_path, m_path = generate_report(
            state, REPORTS_DIR, as_html=html_report, as_md=markdown_report
        )
        if h_path:
            print(f"[REPORT] HTML report written: {h_path}")
        if m_path:
            print(f"[REPORT] Markdown report written: {m_path}")
    else:
        print("[SKIP] Report generation disabled.")

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
        "config": load_config(),
        "now": datetime.utcnow().isoformat(),
        "autofix": autofix,
        "dry_run": False,
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
def auto_fix(dry_run: bool = typer.Option(False, help="Show fixes but do not execute them.")):
    """
    Advanced Meta-Level Healing Protocol.
    Iterates through failing tasks and actively executes their RemediationPlans.
    """
    state = load_state(STATE_PATH)
    discovered = discover_tasks()
    fixes_applied = 0
    failures_remaining = 0

    failed_tasks = [
        t for t, info in state.get("task_status", {}).items() if info.get("status") == "FAIL"
    ]

    if not failed_tasks:
        typer.secho("All tasks healthy. No remediation needed.", fg=typer.colors.GREEN)
        return

    for t in failed_tasks:
        task_callable = discovered.get(t)
        if not task_callable:
            continue

        typer.secho(f"Attempting Healing Protocol for Node: {t}", fg=typer.colors.CYAN, bold=True)
        context = {
            "mode": "diagnose",
            "state": state,
            "now": datetime.now().isoformat(),
            "autofix": True,
        }

        try:
            result = run_task(t, task_callable, context)
            plan: Optional[RemediationPlan] = result.get("remediation_plan")

            if not plan:
                legacy_rec = result.get("recommendation")
                if legacy_rec:
                    typer.secho(
                        f"  Legacy Recommendation exists but cannot auto-execute: {legacy_rec}",
                        fg=typer.colors.YELLOW,
                    )
                else:
                    typer.secho(f"  No remediation plan available for {t}.", fg=typer.colors.RED)
                failures_remaining += 1
                continue

            typer.secho(
                f"  Plan: {plan.get('description', 'Unnamed Execution Block')}",
                fg=typer.colors.BLUE,
            )

            actions_successful = True
            for i, action in enumerate(plan.get("actions", [])):
                typer.secho(
                    f"  [Action {i+1}] Executing {action['action_type']}...", fg=typer.colors.BLUE
                )
                if not execute_remediation(action, dry_run):
                    actions_successful = False
                    break  # Stop executing further actions in this plan if one fails

            if actions_successful and not dry_run:
                # Post-flight check: Rerun the task context lightly to verify fix
                typer.secho("  Post-flight validation...", fg=typer.colors.BLUE)
                post_context = {
                    "mode": "run",
                    "dry_run": False,
                    "state": state,
                    "now": datetime.now().isoformat(),
                }
                post_result = run_task(t, task_callable, post_context)

                if post_result.get("status") == "PASS":
                    typer.secho(f"  {t} SUCCESSFULLY HEALED.", fg=typer.colors.GREEN, bold=True)
                    state["task_status"][t]["status"] = "PASS"
                    fixes_applied += 1
                else:
                    typer.secho(
                        f"  Remediation failed to clear the fault in {t}.", fg=typer.colors.RED
                    )
                    failures_remaining += 1
            elif actions_successful and dry_run:
                typer.secho(f"  Dry-run of plan complete for {t}.", fg=typer.colors.GREEN)
            else:
                failures_remaining += 1

        except Exception as e:
            typer.secho(f"  Critical error during healing of {t}: {e}", fg=typer.colors.RED)
            failures_remaining += 1

    # Save state if we fixed anything
    if fixes_applied > 0 and not dry_run:
        save_state(state, STATE_PATH)
        typer.secho(
            f"\nHealing cycle complete. {fixes_applied} nodes restored.",
            fg=typer.colors.GREEN,
            bold=True,
        )
    elif failures_remaining > 0:
        typer.secho(
            f"\nHealing cycle incomplete. {failures_remaining} nodes require manual intervention.",
            fg=typer.colors.RED,
            bold=True,
        )


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
    ok = generate_default_config(cfg_path)
    if ok:
        typer.echo(f"Default config written to {cfg_path}")
    else:
        typer.echo("Failed to create default config", err=True)
        raise typer.Exit(code=1)


@app.command("archive-reports")
def archive_reports_cmd(
    dry_run: bool = typer.Option(
        False, help="Show which files would be archived without actually doing so."
    ),
):
    """
    Archive and compress all reports (.html and .md) that were not created the current month.
    """
    from nextlevelapex.core.maintenance import archive_old_reports

    # Resolve the reports directory based on our standard layout
    r_dir = APP_ROOT.parent / "reports"
    archive_old_reports(r_dir, dry_run=dry_run)


@app.command("install-archiver")
def install_archiver_cmd():
    """
    Generate and install a macOS launchd agent to run `archive-reports` automatically
    on the 1st of every month at midnight.
    """
    import os
    import subprocess
    import sys
    from pathlib import Path

    agent_name = "com.nextlevelapex.archiver.plist"
    agents_dir = Path.home() / "Library" / "LaunchAgents"
    plist_path = agents_dir / agent_name

    # We resolve the absolute paths so launchd knows exactly what to run without needing $PATH setup
    poetry_bin = subprocess.run(["which", "poetry"], capture_output=True, text=True).stdout.strip()
    if not poetry_bin:
        typer.secho("Error: Could not locate `poetry` executable.", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    main_py_str = str(APP_ROOT / "main2.py")
    cwd_str = str(APP_ROOT.parent)

    plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nextlevelapex.archiver</string>
    <key>ProgramArguments</key>
    <array>
        <string>{poetry_bin}</string>
        <string>run</string>
        <string>python</string>
        <string>{main_py_str}</string>
        <string>archive-reports</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{cwd_str}</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Day</key>
        <integer>1</integer>
        <key>Hour</key>
        <integer>0</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>{cwd_str}/reports/archiver.log</string>
    <key>StandardErrorPath</key>
    <string>{cwd_str}/reports/archiver.error.log</string>
</dict>
</plist>
"""

    agents_dir.mkdir(parents=True, exist_ok=True)
    plist_path.write_text(plist_content)

    # Reload the agent to make it live
    subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True, check=False)
    subprocess.run(["launchctl", "load", "-w", str(plist_path)], capture_output=True, check=False)

    typer.secho(f"✅ Auto-archiver successfully installed to {plist_path}", fg=typer.colors.GREEN)
    typer.secho(
        "It will automatically sweep old reports on the 1st of every month.", fg=typer.colors.CYAN
    )


if __name__ == "__main__":
    app()
