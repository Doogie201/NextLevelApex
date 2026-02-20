# ~/Projects/NextLevelApex/nextlevelapex/tasks/network.py

import json
import os
import shlex
import socket

from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskContext, TaskResult

log = LoggerProxy(__name__)


@task("Advanced Networking")
def setup_networking_tasks(context: TaskContext) -> TaskResult:
    config = context["config"]
    dry_run = context["dry_run"]
    messages = []
    changed = False
    success = True

    networking_cfg = config.get("networking", {})
    if not networking_cfg.get("enable", True):
        messages.append((Severity.INFO, "Networking disabled in config."))
        return TaskResult("Advanced Networking", True, False, messages)

    doh_method = networking_cfg.get("doh_method", "pihole_builtin")
    active_iface = _get_active_network_service_name()
    if not active_iface:
        messages.append((Severity.ERROR, "Could not determine active network interface."))
        return TaskResult("Advanced Networking", False, False, messages)

    messages.append((Severity.INFO, f"Using interface: {active_iface}"))

    vm_ip = _get_colima_vm_ip(dry_run)
    if not vm_ip:
        vm_ip = _get_vm_ip_from_docker_network(dry_run)
        if vm_ip:
            messages.append((Severity.WARNING, "Fallback Colima VM IP obtained via Docker."))

    if not vm_ip:
        messages.append((Severity.ERROR, "Could not retrieve Colima VM IP."))
        return TaskResult("Advanced Networking", False, False, messages)

    host_ip = _get_host_ip_from_colima(dry_run)
    if not host_ip:
        try:
            host_ip = socket.gethostbyname(socket.gethostname())
            messages.append((Severity.WARNING, f"Fallback host IP from socket: {host_ip}"))
        except Exception as e:
            messages.append(
                (
                    Severity.WARNING,
                    f"Could not determine host IP from Colima or socket: {e}",
                )
            )

    if not _ensure_passwordless_networksetup(dry_run):
        messages.append(
            (
                Severity.WARNING,
                "Could not configure passwordless sudo for networksetup.",
            )
        )

    return TaskResult("Advanced Networking", success, changed, messages)


def _get_active_network_service_name() -> str | None:
    try:
        out = run_command(["networksetup", "-listallnetworkservices"], capture=True, check=True)
        for line in out.stdout.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("*") and not stripped.startswith("An asterisk"):
                return stripped
    except Exception as e:
        log.error(f"Failed to detect active network service: {e}")
    return None


def _get_colima_vm_ip(dry_run: bool = False) -> str | None:
    log.info("Fetching Colima VM IP using `colima status --json`...")
    try:
        out = run_command(["colima", "status", "--json"], capture=True, check=True, dry_run=dry_run)
        if not out.success or not out.stdout:
            return "DRYRUN_VM_IP" if dry_run else None

        data = json.loads(out.stdout)
        ip = data.get("ip_address") or data.get("network", {}).get("address")
        if not ip:
            log.warning("No IP found in Colima status output.")
            return None

        return ip
    except Exception as e:
        log.error(f"Error parsing Colima VM IP: {e}", exc_info=True)
        return None


def _get_vm_ip_from_docker_network(dry_run: bool = False) -> str | None:
    try:
        res = run_command(
            ["docker", "network", "inspect", "bridge"],
            capture=True,
            check=False,
            dry_run=dry_run,
        )
        if res.success and res.stdout:
            parsed = json.loads(res.stdout)
            ipam = parsed[0].get("IPAM", {}).get("Config", [{}])[0]
            return ipam.get("Gateway")
    except Exception as e:
        log.warning(f"Docker network fallback IP parse failed: {e}", exc_info=True)
    return None


def _get_host_ip_from_colima(dry_run: bool = False) -> str | None:
    try:
        cmd = ["colima", "ssh", "--", "ip", "route", "get", "1.1.1.1"]
        res = run_command(cmd, capture=True, check=False, dry_run=dry_run)
        for line in res.stdout.splitlines():
            if "via" in line:
                parts = line.split()
                return parts[parts.index("via") + 1]
    except Exception:
        return "192.168.5.1" if not dry_run else "DRYRUN_HOST_IP"
    return None


def _ensure_passwordless_networksetup(dry_run: bool = False) -> bool:
    sudo_file = "/etc/sudoers.d/nextlevelapex-networksetup"
    user = os.environ.get("USER", "user")
    rule = f"{user} ALL=(root) NOPASSWD: /usr/sbin/networksetup -setdnsservers *"

    check = run_command(["sudo", "grep", "-Fxq", rule, sudo_file], check=False, capture=True)
    if check.returncode == 0:
        return True

    if dry_run:
        log.info(f"DRYRUN: Would write rule to {sudo_file}")
        return True

    write_cmd = f'echo "{rule}" | sudo tee {shlex.quote(sudo_file)} > /dev/null'
    result = run_command(["bash", "-c", write_cmd], check=False)
    return result.success
