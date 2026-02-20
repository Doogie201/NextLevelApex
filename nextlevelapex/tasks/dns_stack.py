from __future__ import annotations

import subprocess
from pathlib import Path

from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskContext, TaskResult

# ── Constants ─────────────────────────────────────────────────────
TASK_NAME = "DNS Stack Setup"
STACK_SCRIPT = Path("~/Projects/NextLevelApex/docker/orchestrate.sh").expanduser()

# Optional DNS introspection imports (if needed later)
# from nextlevelapex.tasks.shared.dns_helpers import (
#     is_cloudflared_running_in_vm_only,
#     get_container_status,
# )

log = LoggerProxy(__name__)


# ── Task Implementation ────────────────────────────────────────────
@task(TASK_NAME)
def run(ctx: TaskContext) -> TaskResult:
    dry_run = ctx.get("dry_run", False)

    if not STACK_SCRIPT.exists():
        return TaskResult(
            name=TASK_NAME,
            success=False,
            changed=False,
            messages=[(Severity.ERROR, f"DNS stack script not found at {STACK_SCRIPT}")],
        )

    command = ["bash", str(STACK_SCRIPT)]
    if dry_run:
        command.append("--dry-run")
    else:
        command.extend(["--reset-net", "--rebuild"])

    log.info(f"Executing: {' '.join(command)}")

    try:
        result = run_command(command, dry_run=dry_run)
        return TaskResult(
            name=TASK_NAME,
            success=result.success,
            changed=result.success,
            messages=[(Severity.INFO, "DNS stack setup executed successfully.")],
        )
    except subprocess.CalledProcessError as e:
        log.error(f"Command failed: {e}")
        return TaskResult(
            name=TASK_NAME,
            success=False,
            changed=False,
            messages=[(Severity.ERROR, f"DNS stack script failed with error: {e}")],
        )
