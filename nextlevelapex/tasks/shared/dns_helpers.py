"""Compatibility shim: old import path -> new implementation.

Keeps `from nextlevelapex.tasks.shared.dns_helpers import ...` working by re-exporting
from `nextlevelapex.tasks.dns_helpers`.
"""

from __future__ import annotations

from .. import dns_helpers as _dns

# Public API
cloudflared_status_check = _dns.cloudflared_status_check
pihole_status_check = _dns.pihole_status_check
dns_sanity_check = _dns.dns_sanity_check
run_all_dns_checks = _dns.run_all_dns_checks
is_container_running = _dns.is_container_running

# (Optional) test hooks you intentionally expose
_run = _dns._run
_cmd_exists = _dns._cmd_exists
_engine_name = _dns._engine_name
_engine_context = _dns._engine_context
_engine_inspect = _dns._engine_inspect
_inspect_one = _dns._inspect_one
_is_running = _dns._is_running
_health = _dns._health
_last_health_log = _dns._last_health_log
EXPECTED_CONTEXT = _dns.EXPECTED_CONTEXT

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
