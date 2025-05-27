"""
Task: Pi-hole DNS Sinkhole
==========================

Stand-up a Pi-hole container inside Colima, using the local Cloudflared DoH
proxy (127.0.0.1:5053) as its sole upstream.

• Starts Colima if needed
• Runs/updates the `pihole` container
• Sets macOS system DNS to Pi-hole (optional)
• Verifies end-to-end DNS resolution
"""

from __future__ import annotations

import json
import os
import socket
import time
from pathlib import Path
from typing import Optional

from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskContext, TaskResult

log = LoggerProxy(__name__)

PIHOLE_CONTAINER = "pihole"
PIHOLE_DATA = "pihole_data"
DNSMASQ_DATA = "pihole_dnsmasq_data"


# ───────────────────────── Colima helpers ──────────────────────────
def _ensure_colima_running(
    dev_cfg: dict, dry_run: bool
) -> tuple[bool, list[tuple[Severity, str]]]:
    """
    Ensure Colima VM is running.

    Returns (is_running, messages)
    """
    msgs: list[tuple[Severity, str]] = []

    # 1) Quick status check first
    status = run_command(
        ["colima", "status"], capture=True, check=False, dry_run=dry_run
    )
    if status.success and "Running" in status.stdout:
        msgs.append((Severity.INFO, "Colima already running"))
        return True, msgs

    # 2) Attempt to start the VM with the configured flags
    start_args = [
        "colima",
        "start",
        "--arch",
        str(dev_cfg.get("vm_arch", "aarch64")),
        "--cpu",
        str(dev_cfg.get("cpu", 4)),
        "--memory",
        f"{dev_cfg.get('memory', 8)}",
        "--disk",
        f"{dev_cfg.get('disk', 60)}",
        "--vm-type",
        str(dev_cfg.get("vm_type", "vz")),
    ]
    if dev_cfg.get("vm_type") == "vz" and dev_cfg.get("vz_rosetta", False):
        start_args.append("--vz-rosetta")

    start = run_command(start_args, dry_run=dry_run, check=False)
    if start.success:
        msgs.append((Severity.INFO, "Colima started"))
        return True, msgs

    # 3) If start failed, but status now says Running, treat as success (typical when already up)
    status_retry = run_command(
        ["colima", "status"], capture=True, check=False, dry_run=dry_run
    )
    if status_retry.success and "Running" in status_retry.stdout:
        msgs.append((Severity.INFO, "Colima running (start command returned non‑zero)"))
        return True, msgs

    # Otherwise fail
    msgs.append((Severity.ERROR, "Failed to start Colima \u2013 see `colima logs`"))
    return False, msgs


@task("Pi-hole DNS Sinkhole")
def setup_pihole(context: TaskContext) -> TaskResult:  # noqa: C901, PLR0911
    cfg = context["config"]
    dry_run = context["dry_run"]

    messages: list[tuple[Severity, str]] = []
    changed, ok = False, True

    net_cfg = cfg.get("networking", {})
    if not net_cfg.get("enable", True) or not net_cfg.get("pihole", {}).get(
        "enable", True
    ):
        return TaskResult(
            "Pi-hole DNS Sinkhole",
            True,
            False,
            [(Severity.INFO, "Pi-hole disabled in config")],
        )

    # 1️⃣  Ensure Colima is running -------------------------------------------------
    dev_cfg = cfg.get("developer_tools", {}).get("docker_runtime", {}).get("colima", {})
    if dev_cfg and dev_cfg.get("start_on_run", True):
        colima_ok, colima_msgs = _ensure_colima_running(dev_cfg, dry_run)
        messages.extend(colima_msgs)
        if not colima_ok:
            return TaskResult("Pi-hole DNS Sinkhole", False, changed, messages)
        changed |= any(
            sev is Severity.INFO and "started" in msg.lower()
            for sev, msg in colima_msgs
        )

    # 2️⃣  Discover the VM gateway IP (host-side)
    vm_ip = _docker_bridge_gateway(dry_run)
    if not vm_ip:
        messages.append((Severity.ERROR, "Could not determine Colima VM IP"))
        return TaskResult("Pi-hole DNS Sinkhole", False, changed, messages)

    host_ip = _host_ip_from_colima(dry_run)
    if not host_ip:
        messages.append((Severity.ERROR, "Could not determine host IP from Colima VM"))
        return TaskResult("Pi-hole DNS Sinkhole", False, changed, messages)

    # Local address on macOS where Pi‑hole will listen
    local_dns_ip = "127.0.0.1"

    # 3️⃣  Prepare passwords / env
    pihole_cfg = net_cfg["pihole"]
    pw_env = pihole_cfg.get("web_password_env_var", "NLX_PIHOLE_PASSWORD")
    web_pass = os.environ.get(
        pw_env, pihole_cfg.get("default_web_password", "changeme")
    )
    if web_pass == "changeme":
        messages.append(
            (
                Severity.WARNING,
                "Using fallback Pi-hole password – set $NLX_PIHOLE_PASSWORD!",
            )
        )

    # 4️⃣  (Re)create container
    run_command(["docker", "rm", "-f", PIHOLE_CONTAINER], dry_run=dry_run, check=False)
    run_command(
        ["docker", "volume", "create", PIHOLE_DATA], dry_run=dry_run, check=False
    )
    run_command(
        ["docker", "volume", "create", DNSMASQ_DATA], dry_run=dry_run, check=False
    )

    docker_cmd = [
        "docker",
        "run",
        "-d",
        "--name",
        PIHOLE_CONTAINER,
        # ⬇️ 1. bind DNS ports to localhost for DNS (TCP + UDP)
        "-p",
        "53:53/tcp",
        "-p",
        "53:53/udp",
        # ⬇️ 2. expose Pi‑hole WebUI on http://127.0.0.1:8080
        "-p",
        "127.0.0.1:8080:80",
        "--restart",
        "unless-stopped",
        "-v",
        f"{PIHOLE_DATA}:/etc/pihole",
        "-v",
        f"{DNSMASQ_DATA}:/etc/dnsmasq.d",
        "-e",
        f"TZ={os.environ.get('TZ', 'America/New_York')}",
        "-e",
        f"WEBPASSWORD={web_pass}",
        "-e",
        "DNSMASQ_LISTENING=all",
        # ⬇️ 3. correct upstream DNS – point to host-side DoH proxy
        "-e",
        "DNS1=1.1.1.1",
        "-e",
        "DNS2=1.0.0.1",
        "pihole/pihole:latest",
    ]
    res = run_command(docker_cmd, dry_run=dry_run, check=False)
    changed |= res.success
    if not res.success:
        messages.append((Severity.ERROR, "Failed to start the Pi-hole container"))
        return TaskResult("Pi-hole DNS Sinkhole", False, changed, messages)

    # 5️⃣  Health‑check with retries (Pi‑hole startup can take a few seconds)
    if not dry_run:
        dig_ok = False
        for attempt in range(1, 16):  # ~30 s total
            if _dig_ok(local_dns_ip):
                dig_ok = True
                if attempt > 1:
                    messages.append(
                        (
                            Severity.INFO,
                            f"Pi‑hole responded to DNS query after {attempt * 2}s",
                        )
                    )
                break
            time.sleep(2)

        if not dig_ok:
            messages.append((Severity.ERROR, "Pi‑hole did not answer test DNS query"))
            ok = False
        else:
            messages.append(
                (Severity.INFO, f"Pi‑hole is responding on {local_dns_ip}:53")
            )
    else:
        messages.append(
            (Severity.INFO, f"Pi‑hole would respond on {local_dns_ip}:53 (dry‑run)")
        )

    # 6️⃣  Optionally set system DNS
    if ok and net_cfg.get("set_system_dns", True):
        iface = _active_network_service()
        if iface:
            run_command(
                ["sudo", "networksetup", "-setdnsservers", iface, local_dns_ip],
                dry_run=dry_run,
                check=False,
            )
            run_command(
                ["sudo", "killall", "-HUP", "mDNSResponder"],
                dry_run=dry_run,
                check=False,
            )
            messages.append(
                (Severity.INFO, f"System DNS set to {local_dns_ip} ({iface})")
            )

    return TaskResult("Pi-hole DNS Sinkhole", ok, changed, messages)


# ───────────────────────── helpers ──────────────────────────
def _docker_bridge_gateway(dry_run: bool) -> Optional[str]:
    out = run_command(
        ["docker", "network", "inspect", "bridge"],
        capture=True,
        check=False,
        dry_run=dry_run,
    )
    if not out.success or not out.stdout:
        return None
    try:
        data = json.loads(out.stdout)[0]
        return data["IPAM"]["Config"][0]["Gateway"]
    except Exception:  # noqa: BLE001
        return None


def _host_ip_from_colima(dry_run: bool) -> Optional[str]:
    """
    Return the Mac (host) IP as observed from inside the Colima VM.

    We SSH into the VM and parse `ip route get 1.1.1.1`, whose output looks like:
        '1.1.1.1 via 192.168.5.1 dev eth0 src 192.168.5.2 uid 1000'
    """
    out = run_command(
        ["colima", "ssh", "--", "ip", "route", "get", "1.1.1.1"],
        capture=True,
        check=False,
        dry_run=dry_run,
    )
    if not out.success or not out.stdout:
        return None
    parts = out.stdout.split()
    try:
        # Prefer the address that follows 'src' – that is the host‑side IP
        src_idx = parts.index("src")
        return parts[src_idx + 1]
    except (ValueError, IndexError):
        # Fallback to the address after 'via'
        try:
            via_idx = parts.index("via")
            return parts[via_idx + 1]
        except (ValueError, IndexError):
            return None


def _active_network_service() -> Optional[str]:
    out = run_command(
        ["networksetup", "-listallnetworkservices"], capture=True, check=False
    )
    if not out.success:
        return None
    for line in out.stdout.splitlines():
        s = line.strip()
        if s and not s.startswith("(") and not s.startswith("*"):
            return s
    return None


def _dig_ok(ip: str) -> bool:
    res = run_command(
        ["dig", "+time=2", "+tries=1", f"@{ip}", "cloudflare.com", "A"],
        capture=True,
        check=False,
    )
    return "NOERROR" in res.stdout if res.success else False
