# nextlevelapex/tasks/dns_helpers.py
#!/usr/bin/env python3
"""
DNS Helpers — Cloudflared & Pi-hole (Diagnostics Only)
Read-only diagnostics with:
- Hardened subprocess (timeouts)
- Engine selection: docker → podman fallback
- Context awareness (docker context show; podman has none)
- Health reporting (State.Health.Status + last probe)
- Host conflict checks (ps/port 53 + resolv.conf peek)
- Actionable HINTs and DEBUG breadcrumbs
"""

from __future__ import annotations

import json
import platform
import shutil
import subprocess
from typing import Any

from nextlevelapex.core.task import Severity, TaskResult

# -------- constants --------
ENGINE_TIMEOUT = 5
PS_TIMEOUT = 4
NETSTAT_TIMEOUT = 4
EXPECTED_CONTEXT = "colima"  # only applies to docker

Cmd = list[str]
Msgs = list[tuple[Severity, str]]


# -------- tiny subprocess wrapper --------
def _run(cmd: Cmd, timeout: int = ENGINE_TIMEOUT) -> tuple[int, str, str]:
    try:
        cp = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return cp.returncode, (cp.stdout or "").strip(), (cp.stderr or "").strip()
    except Exception as e:
        return -1, "", f"{type(e).__name__}: {e}"


def _cmd_exists(bin_name: str) -> bool:
    return shutil.which(bin_name) is not None


# -------- engine selection --------
def _engine_name() -> str | None:
    """Prefer docker; fallback to podman if available & responsive."""
    if _cmd_exists("docker"):
        rc, _, _ = _run(["docker", "info"])
        if rc == 0:
            return "docker"
    if _cmd_exists("podman"):
        rc, _, _ = _run(["podman", "info"])
        if rc == 0:
            return "podman"
    return None


def _engine_info() -> tuple[str | None, Msgs]:
    msgs: Msgs = []
    eng = _engine_name()
    if not eng:
        msgs.append((Severity.ERROR, "Neither Docker nor Podman is available/reachable."))
        msgs.append((Severity.HINT, "Install/start Docker Desktop, Colima, or Podman, then retry."))
        return None, msgs
    msgs.append((Severity.DEBUG, f"Engine selected: {eng}"))
    return eng, msgs


# -------- docker/podman parity helpers --------
def _engine_ps_names(eng: str) -> list[str]:
    rc, out, _ = _run([eng, "ps", "--format", "{{.Names}}"])
    if rc != 0 or not out:
        return []
    return [ln for ln in out.splitlines() if ln.strip()]


def _engine_context(eng: str) -> str | None:
    # Docker only; Podman has no "context show"
    if eng != "docker":
        return None
    rc, out, _ = _run(["docker", "context", "show"])
    return out if rc == 0 and out else None


def _engine_inspect(eng: str, names: list[str]) -> list[dict[str, Any]]:
    if not names:
        return []
    rc, out, _ = _run([eng, "inspect", *names])
    if rc != 0 or not out:
        return []
    try:
        data = json.loads(out)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _inspect_one(eng: str, name: str) -> dict[str, Any]:
    data = _engine_inspect(eng, [name])
    return data[0] if data else {}


def _is_running(eng: str, name: str) -> bool:
    info = _inspect_one(eng, name)
    return bool(info and (info.get("State") or {}).get("Running") is True)


def _health(eng: str, name: str) -> str | None:
    info = _inspect_one(eng, name)
    st = info.get("State") or {}
    h = (st.get("Health") or {}).get("Status")
    return str(h) if h else None


def _last_health_log(eng: str, name: str) -> str | None:
    info = _inspect_one(eng, name)
    logs = ((info.get("State") or {}).get("Health") or {}).get("Log") or []
    if not logs:
        return None
    tail = logs[-1]
    out = (tail.get("Output") or "").strip()
    status = tail.get("Status") or ""
    code = tail.get("ExitCode")
    parts = [p for p in [status, f"exit={code}" if code is not None else "", out] if p]
    return " | ".join(parts) if parts else None


# -------- host safety checks --------
def _host_dns_process_lines() -> list[str]:
    if platform.system() == "Windows":
        rc, out, _ = _run(["tasklist"], timeout=PS_TIMEOUT)
    else:
        rc, out, _ = _run(["ps", "aux"], timeout=PS_TIMEOUT)
    if rc != 0 or not out:
        return []
    kws = ["cloudflared", "unbound", "pihole"]
    lines = [ln for ln in out.splitlines() if any(k in ln for k in kws)]
    return [ln for ln in lines if "mDNSResponder" not in ln]


def _host_port_53_binders() -> list[str]:
    cmds: list[Cmd]
    sys = platform.system()
    if sys == "Linux":
        cmds = [["ss", "-tunlp"], ["netstat", "-tulpen"]]
    elif sys == "Darwin":
        cmds = [["lsof", "-nP", "-i", ":53"]]
    else:
        cmds = [["netstat", "-ano"]]
    for c in cmds:
        rc, out, _ = _run(c, timeout=NETSTAT_TIMEOUT)
        if rc == 0 and out:
            lines = [ln for ln in out.splitlines() if ":53" in ln]
            if lines:
                return lines
    return []


def _resolv_conf_summary() -> str | None:
    try:
        with open("/etc/resolv.conf", encoding="utf-8") as f:
            lines = [ln.strip() for ln in f if ln.strip()]
        nameservers = [ln.split()[1] for ln in lines if ln.startswith("nameserver ")]
        search = [ln.split(" ", 1)[1] for ln in lines if ln.startswith("search ")]
        return f"nameservers={nameservers}" + (f" search={search[0]}" if search else "")
    except Exception:
        return None


# -------- shared container check --------
def _container_status_check(display: str, container: str) -> TaskResult:
    msgs: Msgs = []
    eng, pre_msgs = _engine_info()
    msgs.extend(pre_msgs)
    if not eng:
        return TaskResult(name=f"{display} (Helper)", success=False, changed=False, messages=msgs)

    ctx = _engine_context(eng)
    if eng == "docker":
        if ctx != EXPECTED_CONTEXT:
            msgs.append(
                (
                    Severity.WARNING,
                    f"Docker context is '{ctx or 'unknown'}', expected '{EXPECTED_CONTEXT}'.",
                )
            )
            msgs.append(
                (
                    Severity.HINT,
                    "Switch with: `docker context use colima` (or adjust EXPECTED_CONTEXT).",
                )
            )
        else:
            msgs.append((Severity.DEBUG, f"Docker context OK: {ctx}"))

    running = _is_running(eng, container)
    health = _health(eng, container)
    info = _inspect_one(eng, container)
    image = (info.get("Config") or {}).get("Image") or ""
    networks = list((info.get("NetworkSettings") or {}).get("Networks") or {}.keys())
    restart = ((info.get("HostConfig") or {}).get("RestartPolicy") or {}).get("Name") or "none"

    if not running:
        msgs.append((Severity.ERROR, f"Container '{container}' is not running."))
        if image:
            msgs.append((Severity.DEBUG, f"Image: {image}"))
        msgs.append(
            (
                Severity.HINT,
                f"Start via your dns_stack task or `{eng} compose up -d` in the DNS project.",
            )
        )
        success = False
    else:
        msgs.append((Severity.INFO, f"Container '{container}' is running."))
        msgs.append(
            (
                Severity.DEBUG,
                f"Image: {image or 'unknown'} • Networks: {networks or ['bridge']} • Restart: {restart}",
            )
        )
        if health:
            msgs.append((Severity.INFO, f"Health: {health}"))
            if health != "healthy":
                tail = _last_health_log(eng, container)
                if tail:
                    msgs.append((Severity.ERROR, f"Unhealthy last probe: {tail}"))
        else:
            msgs.append((Severity.HINT, "No HEALTHCHECK defined for this image."))
        success = health in (None, "healthy")

    return TaskResult(
        name=f"{display} (Helper)", success=bool(success), changed=False, messages=msgs
    )


# -------- public helpers --------
def cloudflared_status_check() -> TaskResult:
    return _container_status_check("Cloudflared", "cloudflared")


def pihole_status_check() -> TaskResult:
    return _container_status_check("Pi-hole", "pihole")


def dns_sanity_check() -> TaskResult:
    msgs: Msgs = []
    lines = _host_dns_process_lines()
    if lines:
        msgs.append((Severity.ERROR, "DNS services appear to be running on the host:"))
        for ln in lines:
            msgs.append((Severity.ERROR, f"    {ln}"))

    binders = _host_port_53_binders()
    if binders:
        msgs.append((Severity.ERROR, "Processes listening on port 53 detected on host:"))
        for ln in binders[:8]:
            msgs.append((Severity.ERROR, f"    {ln}"))
        if len(binders) > 8:
            msgs.append((Severity.DEBUG, f"    …and {len(binders) - 8} more lines"))

    rc_summary = _resolv_conf_summary()
    if rc_summary:
        msgs.append((Severity.INFO, f"/etc/resolv.conf → {rc_summary}"))

    if lines or binders:
        msgs.append(
            (
                Severity.HINT,
                "Stop host DNS daemons (brew services/systemd) or move them inside the VM only.",
            )
        )
        return TaskResult(name="DNS Sanity Check", success=False, changed=False, messages=msgs)

    msgs.append((Severity.INFO, "No conflicting host DNS processes or listeners found."))
    return TaskResult(name="DNS Sanity Check", success=True, changed=False, messages=msgs)


def is_container_running(container_name: str) -> bool:
    """Compat helper (used by other tasks)."""
    eng, _ = _engine_info()
    return bool(eng and _is_running(eng, container_name))


def run_all_dns_checks() -> list[TaskResult]:
    return [dns_sanity_check(), cloudflared_status_check(), pihole_status_check()]


# Re-export list (and test hooks!)
__all__ = [
    "EXPECTED_CONTEXT",
    "_cmd_exists",
    "_engine_context",
    "_engine_inspect",
    "_engine_name",
    "_health",
    "_inspect_one",
    "_is_running",
    "_last_health_log",
    "_run",
    "cloudflared_status_check",
    "dns_sanity_check",
    "is_container_running",
    "pihole_status_check",
    "run_all_dns_checks",
]
