from __future__ import annotations

import pytest

import nextlevelapex.tasks.dns_sanity as dns_sanity
from nextlevelapex.core.task import Severity


def _msg_contains(result, severity: Severity, needle: str) -> bool:
    return any(level == severity and needle in text for level, text in result.messages)


@pytest.fixture(autouse=True)
def _default_inputs(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_host_cloudflared_listener_healthy", lambda: True)
    monkeypatch.setattr(dns_sanity, "_get_pihole_upstreams", lambda: {"host.docker.internal#5053"})
    monkeypatch.setattr(dns_sanity, "_get_configured_dns_resolvers", lambda: {"192.168.64.2"})


def test_dns_sanity_colima_active_pihole_no_host_conflict(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")

    def fake_ps_names(context=None):
        if context is None:
            return {"pihole"}, True
        if context == "default":
            return set(), False
        return set(), False

    monkeypatch.setattr(dns_sanity, "_docker_ps_names", fake_ps_names)
    monkeypatch.setattr(
        dns_sanity, "_container_running", lambda name, context=None: name == "pihole"
    )

    result = dns_sanity.dns_sanity_check({})

    assert result.success is True
    assert _msg_contains(result, Severity.INFO, "Pi-hole is running")
    assert _msg_contains(result, Severity.DEBUG, "Host Docker context 'default' unavailable")


def test_dns_sanity_flags_legacy_container_conflict(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")

    def fake_ps_names(context=None):
        if context is None:
            return {"pihole", "cloudflared"}, True
        if context == "default":
            return set(), True
        return set(), False

    monkeypatch.setattr(dns_sanity, "_docker_ps_names", fake_ps_names)
    monkeypatch.setattr(
        dns_sanity,
        "_container_running",
        lambda name, context=None: name in {"pihole", "cloudflared"},
    )

    result = dns_sanity.dns_sanity_check({})

    assert result.success is False
    assert _msg_contains(result, Severity.ERROR, "legacy cloudflared container is present")


def test_dns_sanity_accepts_host_cloudflared_listener(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")

    def fake_ps_names(context=None):
        if context is None:
            return {"pihole"}, True
        if context == "default":
            return set(), True
        return set(), False

    monkeypatch.setattr(dns_sanity, "_docker_ps_names", fake_ps_names)
    monkeypatch.setattr(
        dns_sanity, "_container_running", lambda name, context=None: name == "pihole"
    )

    result = dns_sanity.dns_sanity_check({})

    assert result.success is True
    assert _msg_contains(result, Severity.INFO, "cloudflared host listener is reachable")


def test_dns_sanity_fails_on_plaintext_pihole_upstreams(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")
    monkeypatch.setattr(dns_sanity, "_docker_ps_names", lambda context=None: ({"pihole"}, True))
    monkeypatch.setattr(
        dns_sanity, "_container_running", lambda name, context=None: name == "pihole"
    )
    monkeypatch.setattr(
        dns_sanity,
        "_get_pihole_upstreams",
        lambda: {"8.8.8.8", "host.docker.internal#5053"},
    )

    result = dns_sanity.dns_sanity_check({})

    assert result.success is False
    assert _msg_contains(result, Severity.ERROR, "Security drift: Pi-hole upstream includes")
    assert _msg_contains(result, Severity.ERROR, "8.8.8.8")


def test_dns_sanity_fails_when_upstream_drifted_from_host_doh(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")
    monkeypatch.setattr(dns_sanity, "_docker_ps_names", lambda context=None: ({"pihole"}, True))
    monkeypatch.setattr(
        dns_sanity, "_container_running", lambda name, context=None: name == "pihole"
    )
    monkeypatch.setattr(dns_sanity, "_get_pihole_upstreams", lambda: {"172.19.0.2#5053"})

    result = dns_sanity.dns_sanity_check({})

    assert result.success is False
    assert _msg_contains(result, Severity.ERROR, "Pi-hole upstream drift")


def test_dns_sanity_fails_when_doh_listener_is_unhealthy(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")
    monkeypatch.setattr(dns_sanity, "_docker_ps_names", lambda context=None: ({"pihole"}, True))
    monkeypatch.setattr(
        dns_sanity, "_container_running", lambda name, context=None: name == "pihole"
    )
    monkeypatch.setattr(dns_sanity, "_host_cloudflared_listener_healthy", lambda: False)

    result = dns_sanity.dns_sanity_check({})

    assert result.success is False
    assert _msg_contains(result, Severity.ERROR, "DoH listener check failed")


def test_dns_sanity_fails_when_expected_resolver_is_missing(monkeypatch):
    monkeypatch.setattr(dns_sanity, "_get_docker_context", lambda: "colima")
    monkeypatch.setattr(dns_sanity, "_docker_ps_names", lambda context=None: ({"pihole"}, True))
    monkeypatch.setattr(
        dns_sanity, "_container_running", lambda name, context=None: name == "pihole"
    )
    monkeypatch.setattr(dns_sanity, "_get_configured_dns_resolvers", lambda: {"172.17.0.1"})

    result = dns_sanity.dns_sanity_check({})

    assert result.success is False
    assert _msg_contains(result, Severity.ERROR, "Resolver drift: expected only 192.168.64.2")
