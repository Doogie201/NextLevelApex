# ~/Projects/NextLevelApex/nextlevelapex/tasks/dev_tools.py

import logging
from typing import Dict, List

from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskResult
from nextlevelapex.core.types import ColimaStatusResult

log = LoggerProxy(__name__)


@task("Colima Setup")
def setup_colima_task(ctx: Dict) -> TaskResult:
    """
    Task wrapper for Colima VM setup.
    """
    config = ctx.get("config", {})
    dry_run = ctx.get("dry_run", False)

    # run the helper – this returns a ColimaStatusResult, *not* a bool
    colima_status: ColimaStatusResult = setup_colima(config=config, dry_run=dry_run)

    # decide if the task “changed” anything
    # (very simple heuristic: we changed things only if we actually started the VM)
    changed = (
        colima_status.success
        and not dry_run
        and "already running" not in (colima_status.reason or "").lower()
        and "skipping" not in (colima_status.reason or "").lower()
    )

    messages: List[tuple] = []
    if colima_status.success:
        messages.append((Severity.INFO, colima_status.reason))
    else:
        # tests look for this exact text:
        messages.append((Severity.ERROR, "Failed to set up Colima VM"))
        # …and we still include the specific reason for logging/debugging
        messages.append((Severity.ERROR, colima_status.reason))

    return TaskResult(
        name="Colima Setup",
        success=colima_status.success,  # bool, as the tests expect
        changed=changed,
        messages=messages,
        details=colima_status,  # the full structured result
    )


def setup_colima(config: Dict, dry_run: bool = False) -> ColimaStatusResult:
    """
    Starts the Colima VM based on configuration.
    Returns a structured result containing status verification.
    """
    dev_tools_config = config.get("developer_tools", {})
    docker_runtime_config = dev_tools_config.get("docker_runtime", {})
    provider = docker_runtime_config.get("provider", "colima")

    if provider != "colima":
        msg = f"Docker runtime provider is '{provider}', not 'colima'. Skipping setup."
        log.info(msg)
        return ColimaStatusResult(success=True, reason=msg)

    colima_config = docker_runtime_config.get("colima", {})
    if not colima_config.get("start_on_run", False):
        msg = "Colima start skipped as per configuration."
        log.info(msg)
        return ColimaStatusResult(success=True, reason=msg)

    log.info("Attempting to start Colima VM...")

    # Step 1: Check if Colima is already running
    initial_status = run_command(
        ["colima", "status"], dry_run=False, check=False, capture=True
    )
    initial_check = _check_colima_running(initial_status)

    if initial_check.success:
        log.info(f"Colima already running. Reason: {initial_check.reason}")
        return initial_check

    # Step 2: Construct start command
    start_cmd = ["colima", "start"]
    if vm_arch := colima_config.get("vm_arch"):
        start_cmd.extend(["--arch", vm_arch])
    if vm_type := colima_config.get("vm_type"):
        start_cmd.extend(["--vm-type", vm_type])
        if vm_type == "vz" and colima_config.get("vz_rosetta", False):
            start_cmd.append("--vz-rosetta")
    if cpu := colima_config.get("cpu"):
        start_cmd.extend(["--cpu", str(cpu)])
    if memory := colima_config.get("memory"):
        start_cmd.extend(["--memory", str(memory)])
    if disk := colima_config.get("disk"):
        start_cmd.extend(["--disk", str(disk)])

    log.info(f"Colima start command: {' '.join(start_cmd)}")

    if dry_run:
        return ColimaStatusResult(
            success=True,
            reason="Dry run: Colima start simulated.",
            matched_indicators=["dry_run"],
            raw_stdout=None,
            raw_stderr=None,
        )

    # Step 3: Start Colima
    start_result = run_command(start_cmd, dry_run=False, check=False)
    if start_result.returncode != 0:
        log.warning(
            f"Colima start returned RC={start_result.returncode}. Proceeding to verify status..."
        )

    # Step 4: Verify final status
    final_status = run_command(
        ["colima", "status"], dry_run=False, check=True, capture=True
    )
    final_check = _check_colima_running(final_status)

    if final_check.success:
        log.info(
            f"Colima appears to be running. Matched: {final_check.matched_indicators}"
        )
    else:
        log.error(f"Colima verification failed. Reason: {final_check.reason}")

    return final_check


def _check_colima_running(status_result) -> ColimaStatusResult:
    indicators = ["colima is running", "runtime:", "socket:"]
    combined = f"{status_result.stdout or ''}\n{status_result.stderr or ''}".lower()
    matches = [key for key in indicators if key in combined]

    if matches:
        return ColimaStatusResult(
            success=True,
            reason="Colima is running and indicators matched.",
            matched_indicators=matches,
            raw_stdout=status_result.stdout,
            raw_stderr=status_result.stderr,
        )

    return ColimaStatusResult(
        success=False,
        reason="Could not confirm Colima is running. No known indicators matched.",
        matched_indicators=[],
        raw_stdout=status_result.stdout,
        raw_stderr=status_result.stderr,
    )
