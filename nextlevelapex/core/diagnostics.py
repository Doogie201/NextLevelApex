from __future__ import annotations

import datetime
import platform
import shutil
from pathlib import Path
from typing import Any, Dict, Optional

from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.task import TaskContext

log = LoggerProxy(__name__)


def _safe_run_command(cmd: list[str], description: str) -> str:
    """Safely executes a shell command and returns its output or a summarized error."""
    log.debug(f"Running: {description}: {' '.join(cmd)}")
    result = run_command(cmd, check=False, capture=True)
    if result.success:
        return result.stdout.strip() or "No output"
    msg = f"Failed (RC={result.returncode})"
    if result.stderr:
        msg += (
            f" Stderr: {result.stderr[:200]}..."
            if len(result.stderr) > 10
            else f" Stderr: {result.stderr}"
        )
    log.warning(f"{description} failed: {msg}")
    return msg


def collect_base_system_info() -> Dict[str, Any]:
    """Collects basic OS and hardware diagnostics."""
    log.info("Collecting base system info...")
    total, _, free = shutil.disk_usage("/")
    return {
        "os_version": platform.mac_ver()[0],
        "machine": platform.machine(),
        "processor": platform.processor(),
        "hostname": platform.node(),
        "python_version": platform.python_version(),
        "disk_total_gb": f"{total // (2**30)} GB",
        "disk_free_gb": f"{free // (2**30)} GB",
        "uptime": _safe_run_command(["uptime"], "System Uptime"),
    }


def collect_brew_info() -> Dict[str, Any]:
    log.info("Collecting Homebrew diagnostics...")
    if not shutil.which("brew"):
        return {"status": "Homebrew not found"}
    return {
        "config": _safe_run_command(["brew", "config"], "Brew Config"),
        "doctor": _safe_run_command(["brew", "doctor"], "Brew Doctor"),
    }


def collect_colima_info(ctx: TaskContext) -> Dict[str, Any]:
    log.info("Collecting Colima diagnostics...")
    runtime = ctx["config"].get("developer_tools", {}).get("docker_runtime", {})
    if runtime.get("provider") != "colima":
        return {"status": "Colima not configured"}
    if not shutil.which("colima"):
        return {"status": "Colima not found"}
    return {
        "status_output": _safe_run_command(["colima", "status"], "Colima Status"),
        "version": _safe_run_command(["colima", "version"], "Colima Version"),
    }


def collect_docker_info() -> Dict[str, Any]:
    log.info("Collecting Docker diagnostic information...")
    info = {}
    if not shutil.which("docker"):
        info["status"] = "Docker command not found."
        return info
    info["version"] = _safe_run_command(["docker", "version"], "Docker Version")
    info["info"] = _safe_run_command(["docker", "info"], "Docker Info")
    info["ps_a"] = _safe_run_command(["docker", "ps", "-a"], "Docker PS -a")
    return info


def generate_diagnostic_report(
    failed_task_name: Optional[str], error_message: Optional[str], ctx: TaskContext
) -> Dict[str, Any]:
    """Generates a diagnostic snapshot for failed task context."""
    log.info(f"Generating diagnostic report for: {failed_task_name}")
    return {
        "failed_task": failed_task_name,
        "error_message": error_message,
        "timestamp": datetime.datetime.now().isoformat(),
        "system_info": collect_base_system_info(),
        "homebrew_info": collect_brew_info(),
        "colima_info": collect_colima_info(ctx),
        "docker_info": collect_docker_info(),
    }
