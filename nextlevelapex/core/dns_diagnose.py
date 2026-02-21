from __future__ import annotations

import re
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeAlias

EXPECTED_RESOLVER = "192.168.64.2"
PLAINTEXT_RESOLVERS = (
    "8.8.8.8",
    "8.8.4.4",
    "1.1.1.1",
    "1.0.0.1",
    "9.9.9.9",
    "208.67.222.222",
    "208.67.220.220",
)


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class DiagnoseSummary:
    dns_mode: str
    resolver: str
    pihole: str
    pihole_upstream: str
    cloudflared: str
    plaintext_dns: str
    notes: str
    exit_code: int


Runner: TypeAlias = Callable[[list[str], int], CommandResult | None]


def _run_command(cmd: list[str], timeout: int = 2) -> CommandResult | None:
    try:
        cp = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return CommandResult(cp.returncode, (cp.stdout or "").strip(), (cp.stderr or "").strip())


def _first_ip(text: str) -> str:
    match = re.search(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", text)
    return match.group(0) if match else "unknown"


def _parse_nameservers_from_scutil(scutil_output: str) -> list[str]:
    return re.findall(r"nameserver\[\d+\]\s*:\s*([0-9.]+)", scutil_output)


def _normalize_upstreams(raw: str) -> str:
    parts = re.findall(r"[A-Za-z0-9_.:-]+(?:#[0-9]+)?", raw)
    return ",".join(parts) if parts else "unknown"


def _is_plaintext_upstream(upstream_value: str) -> bool | None:
    if upstream_value == "unknown":
        return None
    items = [x.strip().lower() for x in upstream_value.split(",") if x.strip()]
    if not items:
        return None
    for item in items:
        for resolver in PLAINTEXT_RESOLVERS:
            if item == resolver or item.startswith((f"{resolver}:53", f"{resolver}#53")):
                return True
    return False


def collect_dns_summary(runner: Runner | None = None) -> DiagnoseSummary:
    run = _run_command if runner is None else runner

    notes: list[str] = []

    ns_res = run(["networksetup", "-getdnsservers", "Wi-Fi"], 2)
    ns_out = ns_res.stdout if ns_res and ns_res.returncode == 0 else ""
    resolver = _first_ip(ns_out)

    sc_res = run(["scutil", "--dns"], 2)
    sc_out = sc_res.stdout if sc_res and sc_res.returncode == 0 else ""
    sc_nameservers = _parse_nameservers_from_scutil(sc_out)
    if resolver == "unknown" and sc_nameservers:
        resolver = sc_nameservers[0]

    if EXPECTED_RESOLVER in ns_out or EXPECTED_RESOLVER in sc_nameservers:
        dns_mode = "local-private"
    elif "utun" in sc_out.lower():
        dns_mode = "vpn-authoritative"
    else:
        dns_mode = "unknown"

    dig_res = run(
        ["dig", "+time=1", "+tries=1", "+short", "@127.0.0.1", "-p", "5053", "example.com"], 2
    )
    if dig_res is None:
        cloudflared = "unknown"
        notes.append("dig-unavailable")
    elif dig_res.returncode == 0 and dig_res.stdout:
        cloudflared = "ok"
    else:
        cloudflared = "down"
        notes.append("cloudflared-down")

    ps_res = run(["docker", "ps", "--format", "{{.Names}}"], 2)
    if ps_res is None or ps_res.returncode != 0:
        pihole = "unknown"
        pihole_upstream = "unknown"
        plaintext_dns = "unknown"
        notes.append("docker-unavailable")
    else:
        running_names = {ln.strip() for ln in ps_res.stdout.splitlines() if ln.strip()}
        if "pihole" in running_names:
            pihole = "running"
            up_res = run(["docker", "exec", "pihole", "pihole-FTL", "--config", "dns.upstreams"], 2)
            if up_res is None or up_res.returncode != 0:
                pihole_upstream = "unknown"
                plaintext_dns = "unknown"
                notes.append("upstream-unknown")
            else:
                pihole_upstream = _normalize_upstreams(up_res.stdout)
                plain = _is_plaintext_upstream(pihole_upstream)
                if plain is None:
                    plaintext_dns = "unknown"
                elif plain:
                    plaintext_dns = "yes"
                    notes.append("plaintext-upstream")
                else:
                    plaintext_dns = "no"
        else:
            pihole = "missing"
            pihole_upstream = "unknown"
            plaintext_dns = "unknown"

    broken = False
    degraded = False

    if dns_mode != "vpn-authoritative" and resolver != EXPECTED_RESOLVER and pihole == "missing":
        broken = True
        notes.append("resolver-pihole-mismatch")
    if plaintext_dns == "yes":
        broken = True
    if not broken and cloudflared == "down" and dns_mode != "vpn-authoritative":
        degraded = True
    if not broken and pihole in {"unknown", "missing"} and dns_mode == "local-private":
        degraded = True
        notes.append("pihole-not-ready")
    if not broken and resolver == "unknown":
        degraded = True
        notes.append("resolver-unknown")

    exit_code = 2 if broken else 1 if degraded else 0
    notes_text = ";".join(dict.fromkeys(notes)) if notes else "ok"

    return DiagnoseSummary(
        dns_mode=dns_mode,
        resolver=resolver,
        pihole=pihole,
        pihole_upstream=pihole_upstream,
        cloudflared=cloudflared,
        plaintext_dns=plaintext_dns,
        notes=notes_text,
        exit_code=exit_code,
    )


def render_dns_summary(summary: DiagnoseSummary) -> str:
    return (
        f"DNS_MODE={summary.dns_mode} "
        f"RESOLVER={summary.resolver} "
        f"PIHOLE={summary.pihole} "
        f"PIHOLE_UPSTREAM={summary.pihole_upstream} "
        f"CLOUDFLARED={summary.cloudflared} "
        f"PLAINTEXT_DNS={summary.plaintext_dns} "
        f'NOTES="{summary.notes}"'
    )
