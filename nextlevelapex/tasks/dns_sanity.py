from __future__ import annotations

import re
import socket
import subprocess

from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskContext, TaskResult
from nextlevelapex.tasks.dns_stack_runtime import (
    CLOUDFLARED_PORT,
    EXPECTED_RESOLVER_IP,
    LEGACY_CONTAINERS,
    PIHOLE_CONTAINER,
    PIHOLE_UPSTREAM,
)

log = LoggerProxy(__name__)

LOCALHOST = "127.0.0.1"
PLAINTEXT_UPSTREAMS = (
    "8.8.8.8",
    "8.8.4.4",
    "1.1.1.1",
    "1.0.0.1",
    "9.9.9.9",
    "208.67.222.222",
    "208.67.220.220",
)


@task("DNS Stack Sanity Check")
def dns_sanity_check(context: TaskContext) -> TaskResult:
    messages: list[tuple[Severity, str]] = []
    success = True
    _ = context

    active_context = _get_docker_context()
    active_containers, active_ok = _docker_ps_names()
    host_containers, host_ok = (
        _docker_ps_names("default") if active_context == "colima" else (set(), False)
    )

    if not active_ok:
        messages.append(
            (Severity.DEBUG, "Could not list containers from the active Docker context.")
        )

    if active_context == "colima" and not host_ok:
        messages.append(
            (
                Severity.DEBUG,
                "Host Docker context 'default' unavailable; skipping host-container conflict check.",
            )
        )

    host_cloudflared_listener = _host_cloudflared_listener_healthy()
    if host_cloudflared_listener:
        messages.append(
            (
                Severity.INFO,
                f"Confirmed: cloudflared host listener is reachable on {LOCALHOST}:{CLOUDFLARED_PORT}.",
            )
        )
    else:
        success = False
        messages.append(
            (
                Severity.ERROR,
                f"DoH listener check failed: {LOCALHOST}:{CLOUDFLARED_PORT} is unreachable or not resolving queries.",
            )
        )

    pihole_running = (PIHOLE_CONTAINER in active_containers) or _container_running(PIHOLE_CONTAINER)
    if pihole_running:
        messages.append(
            (Severity.INFO, "Confirmed: Pi-hole is running in the active runtime context.")
        )
    else:
        success = False
        messages.append((Severity.ERROR, "Pi-hole is not running in the active runtime context."))

    for name in LEGACY_CONTAINERS:
        in_active = (name in active_containers) or _container_running(name)
        on_host = (
            active_context == "colima"
            and ((host_ok and name in host_containers) or _container_running(name, "default"))
            and not in_active
        )
        if in_active or on_host:
            success = False
            messages.append(
                (
                    Severity.ERROR,
                    f"Conflict: legacy {name} container is present. Remove it to keep the canonical local DNS chain deterministic.",
                )
            )

    upstreams = _get_pihole_upstreams() if pihole_running else None
    if upstreams is None:
        success = False
        messages.append((Severity.ERROR, "Could not inspect Pi-hole upstream configuration."))
    else:
        plaintext = _find_plaintext_upstreams(upstreams)
        if plaintext:
            success = False
            messages.append(
                (
                    Severity.ERROR,
                    f"Security drift: Pi-hole upstream includes plaintext resolver(s): {', '.join(sorted(plaintext))}",
                )
            )
        elif upstreams != {PIHOLE_UPSTREAM}:
            success = False
            messages.append(
                (
                    Severity.ERROR,
                    f"Pi-hole upstream drift: expected only {PIHOLE_UPSTREAM}, observed {', '.join(sorted(upstreams))}.",
                )
            )
        else:
            messages.append((Severity.INFO, "Pi-hole upstream matches the canonical DoH path."))

    dns_resolvers = _get_configured_dns_resolvers()
    if dns_resolvers is None:
        success = False
        messages.append((Severity.ERROR, "Could not determine macOS DNS resolver configuration."))
    elif dns_resolvers != {EXPECTED_RESOLVER_IP}:
        success = False
        messages.append(
            (
                Severity.ERROR,
                f"Resolver drift: expected only {EXPECTED_RESOLVER_IP}, observed {', '.join(sorted(dns_resolvers))}.",
            )
        )
    else:
        messages.append((Severity.INFO, f"Resolver configuration matches {EXPECTED_RESOLVER_IP}."))

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
    except (OSError, subprocess.TimeoutExpired) as exc:
        log.debug("Error while checking Docker context: %s", exc)
        return None
    if result.returncode != 0:
        return None
    context_name = result.stdout.strip()
    return context_name if context_name else None


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
    except (OSError, subprocess.TimeoutExpired) as exc:
        log.debug("Error while checking Docker containers for context '%s': %s", context, exc)
        return set(), False
    if result.returncode != 0:
        return set(), False
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}, True


def _container_running(name: str, context: str | None = None) -> bool:
    cmd = ["docker"]
    if context:
        cmd.extend(["--context", context])
    cmd.extend(["inspect", "-f", "{{.State.Running}}", name])
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        log.debug("Error while inspecting container '%s' in context '%s': %s", name, context, exc)
        return False

    return result.returncode == 0 and result.stdout.strip().lower() == "true"


def _host_cloudflared_listener_healthy() -> bool:
    try:
        with socket.create_connection((LOCALHOST, CLOUDFLARED_PORT), timeout=1.5):
            pass
    except OSError:
        return False

    try:
        dig = subprocess.run(
            [
                "dig",
                "+time=2",
                "+tries=1",
                f"@{LOCALHOST}",
                "-p",
                str(CLOUDFLARED_PORT),
                "example.com",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False

    return dig.returncode == 0 and "NOERROR" in (dig.stdout or "")


def _get_pihole_upstreams() -> set[str] | None:
    try:
        result = subprocess.run(
            ["docker", "exec", PIHOLE_CONTAINER, "pihole-FTL", "--config", "dns.upstreams"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None
    tokens = set(re.findall(r"[A-Za-z0-9_.:-]+(?:#[0-9]+)?", result.stdout or ""))
    return {token for token in tokens if token}


def _find_plaintext_upstreams(upstreams: set[str]) -> set[str]:
    findings: set[str] = set()
    for upstream in upstreams:
        normalized = upstream.lower()
        for resolver in PLAINTEXT_UPSTREAMS:
            if normalized == resolver or normalized.startswith(
                (f"{resolver}#53", f"{resolver}:53")
            ):
                findings.add(upstream)
    return findings


def _get_configured_dns_resolvers() -> set[str] | None:
    try:
        networksetup = subprocess.run(
            ["networksetup", "-getdnsservers", "Wi-Fi"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        scutil = subprocess.run(
            ["scutil", "--dns"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    values = set(re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", networksetup.stdout or ""))
    values.update(re.findall(r"nameserver\[\d+\]\s*:\s*([0-9.]+)", scutil.stdout or ""))
    return values if values else None
