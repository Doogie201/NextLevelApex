from __future__ import annotations

import socket
import subprocess

from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskContext, TaskResult
from nextlevelapex.tasks.shared.dns_helpers import is_container_running

log = LoggerProxy(__name__)

CONFLICT_CONTAINERS = ["cloudflared", "pihole", "unbound"]
DIG_PROXY_PORT = 5053
LOCALHOST = "127.0.0.1"


@task("DNS Stack Sanity Check")
def dns_sanity_check(context: TaskContext) -> TaskResult:
    messages: list[tuple[Severity, str]] = []
    success = True

    log.info("🧠 Starting DNS stack sanity validation…")

    active_context = _get_docker_context()
    active_containers, active_ok = _docker_ps_names()
    host_containers: set[str] = set()
    host_check_ok = False

    if not active_ok:
        messages.append(
            (
                Severity.DEBUG,
                "Could not list containers from active Docker context; using container inspect fallback.",
            )
        )

    if active_context == "colima":
        host_containers, host_check_ok = _docker_ps_names("default")
        if not host_check_ok:
            messages.append(
                (
                    Severity.DEBUG,
                    "Host Docker context 'default' unavailable; skipping host-container conflict check.",
                )
            )
    elif active_context:
        messages.append((Severity.DEBUG, f"Docker context detected: {active_context}"))
    else:
        messages.append((Severity.DEBUG, "Docker context unknown; using active context only."))

    host_cloudflared_listener = _host_cloudflared_listener_healthy()

    for name in CONFLICT_CONTAINERS:
        in_active_context = (name in active_containers) or is_container_running(name)
        host_conflict = (
            active_context == "colima"
            and host_check_ok
            and name in host_containers
            and not in_active_context
        )

        if host_conflict:
            success = False
            messages.append(
                (
                    Severity.ERROR,
                    f"Conflict: {name} container is running on host instead of Colima. Run `docker rm -f {name}`.",
                )
            )
        elif in_active_context:
            messages.append(
                (Severity.INFO, f"Confirmed: {name} is running in active runtime context.")
            )
        elif name == "cloudflared" and host_cloudflared_listener:
            messages.append(
                (
                    Severity.INFO,
                    "Confirmed: cloudflared host listener is reachable on 127.0.0.1:5053.",
                )
            )
        else:
            messages.append(
                (
                    Severity.WARNING,
                    f"{name} not found running in any container. Might be expected for dry-run or partial stacks.",
                )
            )

    return TaskResult("DNS Stack Sanity Check", success, False, messages)


def _get_docker_context() -> str | None:
    try:
        result = subprocess.run(
            ["docker", "context", "show"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        if result.returncode != 0:
            return None
        context_name = result.stdout.strip()
        return context_name if context_name else None
    except Exception as e:
        log.debug("Error while checking Docker context: %s", e)
        return None


def _docker_ps_names(context: str | None = None) -> tuple[set[str], bool]:
    cmd = ["docker"]
    if context:
        cmd.extend(["--context", context])
    cmd.extend(["ps", "--format", "{{.Names}}"])
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        if result.returncode != 0:
            return set(), False
        names = {line.strip() for line in result.stdout.splitlines() if line.strip()}
        return names, True
    except Exception as e:
        log.debug("Error while checking Docker containers for context '%s': %s", context, e)
        return set(), False


def _host_cloudflared_listener_healthy() -> bool:
    try:
        with socket.create_connection((LOCALHOST, DIG_PROXY_PORT), timeout=1.5):
            return True
    except OSError:
        return False
