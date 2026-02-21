from __future__ import annotations

import nextlevelapex.tasks.dns_sanity as dns_sanity
from nextlevelapex.core.task import Severity


def _msg_contains(result, severity: Severity, needle: str) -> bool:
    return any(level == severity and needle in text for level, text in result.messages)


def test_dns_sanity_colima_active_pihole_no_host_conflict(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")

    def fake_ps_names(context=None):
        if context is None:
            return {"pihole"}, True
        if context == "default":
            return set(), False
        return set(), False

    monkeypatch.setattr(dns_sanity, "_docker_ps_names", fake_ps_names)
    monkeypatch.setattr(dns_sanity, "is_container_running", lambda name: name == "pihole")
    monkeypatch.setattr(dns_sanity, "_host_cloudflared_listener_healthy", lambda: True)

    result = dns_sanity.dns_sanity_check({})

    assert result.success is True
    assert not _msg_contains(result, Severity.ERROR, "running on host instead of Colima")
    assert _msg_contains(result, Severity.DEBUG, "Host Docker context 'default' unavailable")


def test_dns_sanity_flags_real_host_conflict(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")

    def fake_ps_names(context=None):
        if context is None:
            return set(), True
        if context == "default":
            return {"pihole"}, True
        return set(), False

    monkeypatch.setattr(dns_sanity, "_docker_ps_names", fake_ps_names)
    monkeypatch.setattr(dns_sanity, "is_container_running", lambda name: False)
    monkeypatch.setattr(dns_sanity, "_host_cloudflared_listener_healthy", lambda: False)

    result = dns_sanity.dns_sanity_check({})

    assert result.success is False
    assert _msg_contains(result, Severity.ERROR, "Conflict: pihole container is running on host")


def test_dns_sanity_accepts_host_cloudflared_listener(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")

    def fake_ps_names(context=None):
        if context is None:
            return {"pihole"}, True
        if context == "default":
            return set(), True
        return set(), False

    monkeypatch.setattr(dns_sanity, "_docker_ps_names", fake_ps_names)
    monkeypatch.setattr(dns_sanity, "is_container_running", lambda name: name == "pihole")
    monkeypatch.setattr(dns_sanity, "_host_cloudflared_listener_healthy", lambda: True)

    result = dns_sanity.dns_sanity_check({})

    assert result.success is True
    assert _msg_contains(
        result, Severity.INFO, "cloudflared host listener is reachable on 127.0.0.1:5053"
    )
    assert not _msg_contains(
        result, Severity.WARNING, "cloudflared not found running in any container"
    )
