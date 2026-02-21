from __future__ import annotations

import datetime
import json
import platform
import shutil
from pathlib import Path
from typing import Any

from nextlevelapex.core.command import CommandResult, run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.task import TaskContext

# Re-export for tests importing from core.diagnostics
from nextlevelapex.utils.sanitizer import trim_large_fields  # re-export for tests

__all__ = ["trim_large_fields"]


# Re-export for tests that import from core.diagnostics

log = LoggerProxy(__name__)

# --- Helper for running diagnostic commands safely ---


def _safe_diag_run(
    cmd_list: list[str], description: str, capture: bool = True, check: bool = False
) -> CommandResult:
    """Wrapper for run_command for diagnostic purposes, always non-fatal to diagnostics itself."""
    log.debug(f"Diag: Running for '{description}': {' '.join(cmd_list)}")
    try:
        # Diagnostics should not run in dry_run mode unless specifically told to simulate
        # For now, actual diagnostic commands will run.
        return run_command(cmd_list, dry_run=False, check=check, capture=capture)
    except Exception as e:
        log.warning(f"Diag: Exception running command for '{description}': {e}")
        return CommandResult(returncode=-1, stdout="", stderr=str(e), success=False)


def _get_file_snippet(file_path: Path, tail_lines: int = 20) -> str:
    """Safely gets the last N lines of a file, or an error message."""
    try:
        if file_path.is_file():
            with file_path.open("r", errors="ignore") as f:
                lines = f.readlines()
                return "".join(lines[-tail_lines:])
        return "File not found or not a file."
    except Exception as e:
        return f"Error reading file: {e}"


# --- Information Collectors ---


def collect_base_system_info() -> dict[str, Any]:
    info = {}
    log.debug("Diag: Collecting base system info...")
    try:
        info["os_version"] = platform.mac_ver()[0]
        info["architecture"] = platform.machine()
        info["processor"] = platform.processor()
        info["hostname"] = platform.node()
        info["python_version"] = platform.python_version()
        total, _, free = shutil.disk_usage("/")
        info["disk_total_gb"] = f"{total // (2**30)}"
        info["disk_free_gb"] = f"{free // (2**30)}"
        info["uptime"] = _safe_diag_run(["uptime"], "Uptime").stdout
        info["active_user"] = _safe_diag_run(["whoami"], "Active User").stdout
    except Exception as e:
        info["error"] = f"Failed to collect base system info: {e}"
    return info


def collect_brew_info(context: TaskContext) -> dict[str, Any]:
    if not context["config"].get("script_behavior", {}).get("enable_bloat_protection", False):
        return {"status": "Skipped due to bloat protection"}
    info = {"status": "Brew command not available."}
    log.debug("Diag: Collecting Homebrew info...")
    if shutil.which("brew"):
        info["status"] = "OK"
        info["version"] = _safe_diag_run(["brew", "--version"], "Brew Version").stdout
        info["config"] = _safe_diag_run(["brew", "config"], "Brew Config").stdout
        info["doctor_summary"] = _safe_diag_run(
            ["brew", "doctor", "--quiet"], "Brew Doctor Summary"
        ).stderr
    return info


def collect_colima_info(context: TaskContext) -> dict[str, Any]:
    if not context["config"].get("script_behavior", {}).get("enable_bloat_protection", False):
        return {"status": "Skipped due to bloat protection"}
    info = {"status": "Colima command not available or not configured provider."}
    log.debug("Diag: Collecting Colima info...")
    config = context["config"]
    if config.get("developer_tools", {}).get("docker_runtime", {}).get(
        "provider"
    ) == "colima" and shutil.which("colima"):
        info["status"] = "OK"
        info["version"] = _safe_diag_run(["colima", "version"], "Colima Version").stdout
        info["colima_status_output"] = _safe_diag_run(
            ["colima", "status", "--verbose"], "Colima Status Verbose"
        ).stdout
    return info


def collect_docker_info(context: TaskContext) -> dict[str, Any]:
    if not context["config"].get("script_behavior", {}).get("enable_bloat_protection", False):
        return {"status": "Skipped due to bloat protection"}
    info = {"status": "Docker command not available."}
    log.debug("Diag: Collecting Docker info...")
    if shutil.which("docker"):
        info["status"] = "OK"
        info["version"] = _safe_diag_run(["docker", "version"], "Docker Version").stdout
        info["contexts"] = _safe_diag_run(["docker", "context", "ls"], "Docker Contexts").stdout
        info["containers"] = _safe_diag_run(
            [
                "docker",
                "ps",
                "-a",
                "--format",
                "table {{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Status}}",
            ],
            "Docker Containers",
        ).stdout
        info["networks"] = _safe_diag_run(["docker", "network", "ls"], "Docker Networks").stdout
        info["volumes"] = _safe_diag_run(["docker", "volume", "ls"], "Docker Volumes").stdout
    return info


def collect_network_config_info(context: TaskContext) -> dict[str, Any]:
    info = {}
    log.debug("Diag: Collecting Network Configuration info...")
    try:
        # Re-use _get_active_network_service_name if it's robustly placed in core utils
        # For now, simplified direct call
        active_service = "Wi-Fi"  # Default, needs robust detection
        route_res = run_command(["route", "-n", "get", "default"], check=False, capture=True)
        if route_res.success:
            iface = next(
                (
                    line.split(":")[1].strip()
                    for line in route_res.stdout.splitlines()
                    if "interface:" in line.lower()
                ),
                None,
            )
            if iface:
                order_res = run_command(
                    ["networksetup", "-listnetworkserviceorder"],
                    check=False,
                    capture=True,
                )
                if order_res.success:
                    lines = order_res.stdout.splitlines()
                    for i, line_content in enumerate(lines):
                        if (
                            (f"(Device: {iface})" in line_content)
                            or line_content.endswith(f"Device: {iface}")
                        ) and i > 0:
                            name_part = lines[i - 1]
                            active_service = (
                                name_part.strip().split()[-1] if name_part.strip() else ""
                            )
                            break
        info["determined_active_service"] = active_service
        info[f"dns_for_{active_service.replace(' ', '_')}"] = _safe_diag_run(
            ["networksetup", "-getdnsservers", active_service],
            f"DNS for {active_service}",
        ).stdout
        info["scutil_dns"] = _safe_diag_run(["scutil", "--dns"], "scutil --dns").stdout
        info["ping_gateway"] = _safe_diag_run(
            [
                "ping",
                "-c",
                "3",
                context["config"].get("networking", {}).get("router_ip", "192.168.1.1"),
            ],
            "Ping Gateway",
        ).stdout  # Router IP from config?
        info["ping_external"] = _safe_diag_run(
            ["ping", "-c", "3", "1.1.1.1"], "Ping External (1.1.1.1)"
        ).stdout
    except Exception as e:
        info["error"] = f"Error collecting network config info: {e}"
    return info


def collect_ollama_info(context: TaskContext) -> dict[str, Any]:
    info = {"status": "Ollama command not available or disabled."}
    log.debug("Diag: Collecting Ollama info...")
    config = context["config"]
    if config.get("local_ai", {}).get("ollama", {}).get("enable", False) and shutil.which("ollama"):
        info["status"] = "OK"
        info["version"] = _safe_diag_run(["ollama", "--version"], "Ollama Version").stdout
        info["list_models"] = _safe_diag_run(["ollama", "list"], "Ollama List Models").stdout
        info["ps"] = _safe_diag_run(["ollama", "ps"], "Ollama PS").stdout  # Show running models
        if shutil.which("brew"):
            info["brew_service_status"] = _safe_diag_run(
                ["brew", "services", "list"], "Brew Services List"
            ).stdout
    return info


def collect_log_snippets(context: TaskContext) -> dict[str, str]:
    log.debug("Diag: Collecting log snippets...")
    snippets = {}
    # NextLevelApex own log file
    log_dir = Path.home() / "Library" / "Logs" / "NextLevelApex"
    app_logs = sorted(log_dir.glob("nextlevelapex-run-*.log"), reverse=True)
    if app_logs:
        snippets["nextlevelapex_latest_log"] = _get_file_snippet(app_logs[0], tail_lines=100)

    # Pi-hole log (if relevant config exists and container running)
    if context["config"].get("networking", {}).get("pihole", {}).get("enable", False):
        pihole_status_res = _safe_diag_run(
            ["docker", "ps", "-q", "-f", "name=pihole"], "Check Pihole Docker Status"
        )
        if pihole_status_res.success and pihole_status_res.stdout:  # Container ID found
            snippets["pihole_docker_log"] = _safe_diag_run(
                ["docker", "logs", "pihole", "--tail", "50"], "Pi-hole Docker Logs"
            ).stdout
        else:
            snippets["pihole_docker_log"] = "Pi-hole container not found or not running."

    # Cloudflared host agent log (if relevant)
    if context["config"].get("networking", {}).get("doh_method") == "host_cloudflared":
        doh_log_path = (
            Path.home() / "Library" / "Logs" / "NextLevelApex" / "com.nextlevelapex.doh.log"
        )
        snippets["cloudflared_host_log"] = _get_file_snippet(doh_log_path, tail_lines=50)

    return snippets


# --- Main Diagnostic Orchestrator ---


def generate_diagnostic_report(
    failed_task_name: str | None,
    error_info: Any,  # Could be an exception object or a string
    context: TaskContext,
) -> dict[str, Any]:
    """Generates a comprehensive diagnostic report upon failure."""
    log.info(f"Generating diagnostic report for failure in task: '{failed_task_name}'...")

    report: dict[str, Any] = {
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
        "failed_task": failed_task_name,
        "error_details": str(error_info),  # Convert exception to string
        "script_config_summary": {  # Only include non-sensitive parts or a summary
            "dry_run": context["dry_run"],
            "verbose": context["verbose"],
            # Add other relevant high-level config flags if safe
        },
        "system_info": collect_base_system_info(),
        "homebrew_info": collect_brew_info(context),
        "colima_info": collect_colima_info(context),
        "docker_info": collect_docker_info(context),
        "network_config_info": collect_network_config_info(context),
        "ollama_info": collect_ollama_info(context),
        "log_snippets": collect_log_snippets(context),
        # TODO: Add task-specific diagnostics if available
    }

    # --- Ollama Analysis (Apex Feature) ---
    ollama_config = context["config"].get("local_ai", {}).get("ollama", {})
    diag_config = context["config"].get("script_behavior", {})

    if (
        diag_config.get("enable_ollama_error_analysis", True)
        and ollama_config.get("enable", False)
        and shutil.which("ollama")
    ):
        log.info("Attempting diagnostic analysis with Ollama...")
        try:
            # Ensure a model is specified, fallback to mistral
            analysis_model = ollama_config.get("diagnostic_analysis_model", "mistral:7b")
            # Check if model is available
            list_models_res = _safe_diag_run(["ollama", "list"], "Ollama List (for diag)")
            if analysis_model.split(":")[0] not in list_models_res.stdout:  # Check base model name
                log.warning(
                    f"Ollama model '{analysis_model}' for analysis not found. Pulling it now..."
                )
                pull_res = _safe_diag_run(
                    ["ollama", "pull", analysis_model], f"Pull {analysis_model}"
                )
                if not pull_res.success:
                    raise Exception(
                        f"Failed to pull diagnostic model {analysis_model}. Stderr: {pull_res.stderr}"
                    )

            # Serialize the report for the prompt (excluding this analysis itself)
            report_for_ollama = {k: v for k, v in report.items() if k != "ollama_analysis"}

            from nextlevelapex.utils.sanitizer import trim_large_fields

            report_for_ollama_trimmed, bloat_stats = trim_large_fields(report_for_ollama)
            report["bloat_sanitizer_stats"] = bloat_stats

            # Serialize the trimmed report
            report_str = json.dumps(report_for_ollama_trimmed, indent=2, sort_keys=True)

            # Limit report string length to avoid overly long prompts
            max_prompt_len = 8000
            if len(report_str) > max_prompt_len:
                report_str = report_str[:max_prompt_len] + "\n... (report truncated due to length)"

            prompt = (
                f"You are an expert macOS and DevOps troubleshooting assistant. "
                f"The following is a diagnostic report from an automated Mac setup script called 'NextLevelApex'. "
                f"The script failed while executing the task: '{failed_task_name}'. "
                f"The primary error was: '{error_info}'.\n\n"
                f"Please analyze the full diagnostic report below, identify the most likely root cause(s) "
                f"for the failure of the '{failed_task_name}' task, and suggest 2-3 specific, actionable "
                f"troubleshooting steps or commands the user can run. Be concise and focus on the most probable issues first. "
                f"Assume the user has technical proficiency.\n\n"
                f"DIAGNOSTIC REPORT:\n```json\n{report_str}\n```\n\n"
                f"ANALYSIS AND SUGGESTIONS:"
            )
            log.debug(
                f"Ollama analysis prompt (model: {analysis_model}):\n{prompt[:500]}..."
            )  # Log start of prompt

            # Use a timeout for Ollama as it can sometimes hang
            ollama_cmd = ["ollama", "run", analysis_model, prompt]
            # Note: `run_command` with timeout needs to be robust
            # For simplicity, assuming run_command will handle it or Ollama CLI has internal timeouts.
            # A more robust solution for potentially long AI calls might use async or a dedicated thread.

            import subprocess

            ollama_response = subprocess.run(
                ollama_cmd,
                capture_output=True,
                timeout=90,
                text=True,
            )

            if ollama_response.returncode == 0:
                report["ollama_analysis"] = {
                    "model": analysis_model,
                    "prompt": prompt[:3000] + "...",  # Save truncated prompt for context
                    "ai_response": ollama_response.stdout.strip(),
                }
                log.info("Ollama analysis completed.")
            else:
                report["ollama_analysis_error"] = {
                    "error": "Ollama command failed.",
                    "stderr": ollama_response.stderr.strip(),
                }
                log.warning(f"Ollama analysis failed: {ollama_response.stderr}")

                log.info("Ollama analysis completed.")

        except Exception as e:
            log.error(f"Exception during Ollama diagnostic analysis: {e}", exc_info=True)
            report["ollama_analysis_error"] = f"Exception during analysis: {e!s}"
    else:
        log.info("Ollama error analysis disabled or Ollama not available.")

    sanitized_report, bloat_stats = trim_large_fields(report)
    report["bloat_sanitizer_stats"] = bloat_stats

    return report
