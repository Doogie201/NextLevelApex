from __future__ import annotations

import subprocess

from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskContext, TaskResult
from nextlevelapex.tasks.shared.dns_helpers import is_container_running

log = LoggerProxy(__name__)

CONFLICT_CONTAINERS = ["cloudflared", "pihole", "unbound"]


@task("DNS Stack Sanity Check")
def dns_sanity_check(context: TaskContext) -> TaskResult:
    messages: list[tuple[Severity, str]] = []
    success = True

    log.info("🧠 Starting DNS stack sanity validation…")

    # 🔍 Step 1: Detect if any DNS containers are running on the host instead of Colima
    host_containers = _get_host_docker_containers()

    for name in CONFLICT_CONTAINERS:
        if name in host_containers:
            success = False
            messages.append(
                (
                    Severity.ERROR,
                    f"Conflict: {name} container is running on host instead of Colima. Run `docker rm -f {name}`.",
                )
            )
        elif is_container_running(name):
            messages.append((Severity.INFO, f"Confirmed: {name} is running inside Colima."))
        else:
            messages.append(
                (
                    Severity.WARNING,
                    f"{name} not found running in any container. Might be expected for dry-run or partial stacks.",
                )
            )

    return TaskResult("DNS Stack Sanity Check", success, False, messages)


def _get_host_docker_containers() -> list[str]:
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            return []

        container_names = result.stdout.strip().splitlines()
        return container_names

    except Exception as e:
        log.error(f"Error while checking host containers: {e}")
        return []
