# ~/Projects/NextLevelApex/nextlevelapex/tasks/dev_tools.py

import logging
from typing import Dict

from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskResult

log = LoggerProxy(__name__)


@task("Colima Setup")
def setup_colima_task(ctx: Dict) -> TaskResult:
    # raise RuntimeError("Simulated task crash for diagnostics test")
    """
    Task wrapper for Colima VM setup.
    """
    config = ctx.get("config", {})
    dry_run = ctx.get("dry_run", False)
    success = setup_colima(config=config, dry_run=dry_run)

    messages = []
    if not success:
        messages.append((Severity.ERROR, "Failed to set up Colima VM"))

    return TaskResult(
        name="Colima Setup",
        success=success,
        changed=success and not dry_run,
        messages=[] if success else [(Severity.ERROR, "Failed to set up Colima VM")],
    )


def setup_colima(config: Dict, dry_run: bool = False) -> bool:
    """
    Starts the Colima VM based on configuration.
    Assumes Colima and Docker CLI are already installed via Homebrew.
    """
    dev_tools_config = config.get("developer_tools", {})
    docker_runtime_config = dev_tools_config.get("docker_runtime", {})
    provider = docker_runtime_config.get("provider", "colima")

    if provider != "colima":
        log.info(
            f"Docker runtime provider is '{provider}', not 'colima'. Skipping Colima-specific setup."
        )
        return True

    colima_config = docker_runtime_config.get("colima", {})
    if not colima_config.get("start_on_run", False):
        log.info("Skipping Colima start as per configuration.")
        return True

    log.info("Attempting to start Colima VM...")

    status_result = run_command(
        ["colima", "status"], dry_run=False, check=False, capture=True
    )
    if status_result.success and "colima is running" in status_result.stdout.lower():
        log.info("Colima is already running.")
        return True

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

    start_result = run_command(start_cmd, dry_run=dry_run, check=False)

    if not dry_run:
        if start_result.returncode == 0:
            log.info("Colima started successfully.")
        else:
            log.warning(
                f"Colima start returned RC={start_result.returncode}. Checking status..."
            )

        final_status = run_command(
            ["colima", "status"], dry_run=False, check=True, capture=True
        )

        if final_status.success:
            lowered_output = final_status.stdout.lower()
            log.debug(f"Colima status output:\n{lowered_output}")

            # More relaxed: look for the exact known phrase
            if "colima is running" in lowered_output:
                log.info("Colima appears to be running (relaxed match).")
                run_command(["sleep", "5"], dry_run=dry_run)
                return True
            else:
                log.warning(
                    "Could not confirm Colima is running — match phrase not found."
                )
                return False
    return False
