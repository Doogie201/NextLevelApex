from __future__ import annotations

import platform
import re
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
EXPECTED_DNS_RESOLVER = "192.168.64.2"
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

    if not host_cloudflared_listener:
        success = False
        messages.append(
            (
                Severity.ERROR,
                "DoH listener check failed: 127.0.0.1:5053 is unreachable or not resolving queries.",
            )
        )

    if "pihole" in active_containers or is_container_running("pihole"):
        upstreams = _get_pihole_upstreams()
        if upstreams is None:
            messages.append(
                (
                    Severity.WARNING,
                    "Could not inspect Pi-hole upstream configuration for plaintext resolver drift.",
                )
            )
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
            else:
                messages.append(
                    (
                        Severity.INFO,
                        "Pi-hole upstream appears DoH-proxied (no known plaintext resolver drift).",
                    )
                )

    dns_resolvers = _get_configured_dns_resolvers()
    if dns_resolvers is None:
        messages.append(
            (
                Severity.WARNING,
                "Could not determine macOS DNS resolver configuration.",
            )
        )
    elif EXPECTED_DNS_RESOLVER not in dns_resolvers:
        success = False
        messages.append(
            (
                Severity.ERROR,
                f"Resolver drift: expected {EXPECTED_DNS_RESOLVER}, observed {', '.join(sorted(dns_resolvers))}.",
            )
        )
    else:
        messages.append(
            (Severity.INFO, f"Resolver configuration includes {EXPECTED_DNS_RESOLVER}.")
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
                str(DIG_PROXY_PORT),
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
            ["docker", "exec", "pihole", "pihole-FTL", "--config", "dns.upstreams"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None
    raw = (result.stdout or "").strip()
    if not raw:
        return None
    tokens = set(re.findall(r"[A-Za-z0-9_.:-]+(?:#[0-9]+)?", raw))
    return {t for t in tokens if t}


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
    if platform.system() != "Darwin":
        return None

    resolvers: set[str] = set()

    try:
        networksetup = subprocess.run(
            ["networksetup", "-getdnsservers", "Wi-Fi"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        if networksetup.returncode == 0:
            for line in (networksetup.stdout or "").splitlines():
                item = line.strip()
                if item and "There aren't any DNS Servers set" not in item:
                    resolvers.add(item)
    except (OSError, subprocess.TimeoutExpired):
        pass

    try:
        scutil = subprocess.run(
            ["scutil", "--dns"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        if scutil.returncode == 0:
            for match in re.findall(r"nameserver\[\d+\]\s*:\s*([0-9.]+)", scutil.stdout or ""):
                resolvers.add(match)
    except (OSError, subprocess.TimeoutExpired):
        pass

    return resolvers if resolvers else None
