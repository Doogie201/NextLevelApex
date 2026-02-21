import json

import pytest

import nextlevelapex.tasks.dns_helpers as dns
from nextlevelapex.core.task import Severity


# ---------- helpers ----------
def fake_run_factory(mapper):
    """
    mapper: dict[str -> (rc, stdout, stderr)]
    key is the exact command joined by spaces.
    """

    def _fake_run(cmd, timeout=5):
        key = " ".join(cmd)
        if key in mapper:
            return mapper[key]
        return (1, "", f"missing stub for: {key}")

    return _fake_run


def stub_engine(monkeypatch, name="docker"):
    monkeypatch.setattr(dns, "_cmd_exists", lambda n: (n == name))
    # ensure the other engine is not available
    if name == "docker":
        monkeypatch.setattr(dns, "_engine_name", lambda: "docker")
    elif name == "podman":
        monkeypatch.setattr(dns, "_engine_name", lambda: "podman")
    else:
        monkeypatch.setattr(dns, "_engine_name", lambda: None)


# ---------- fixtures ----------
@pytest.fixture
def healthy_inspect_json():
    return json.dumps(
        [
            {
                "State": {
                    "Running": True,
                    "Health": {
                        "Status": "healthy",
                        "Log": [{"Status": "healthy", "ExitCode": 0, "Output": "ok"}],
                    },
                },
                "Config": {"Image": "example/image:latest"},
                "NetworkSettings": {"Networks": {"bridge": {}}},
                "HostConfig": {"RestartPolicy": {"Name": "always"}},
            }
        ]
    )


@pytest.fixture
def unhealthy_inspect_json():
    return json.dumps(
        [
            {
                "State": {
                    "Running": True,
                    "Health": {
                        "Status": "unhealthy",
                        "Log": [
                            {
                                "Status": "unhealthy",
                                "ExitCode": 1,
                                "Output": "probe failed",
                            }
                        ],
                    },
                },
                "Config": {"Image": "example/image:latest"},
                "NetworkSettings": {"Networks": {"bridge": {}}},
                "HostConfig": {"RestartPolicy": {"Name": "always"}},
            }
        ]
    )


# ---------- tests ----------
def test_cloudflared_healthy_happy_path(monkeypatch, healthy_inspect_json):
    stub_engine(monkeypatch, "docker")
    mapping = {
        "docker info": (0, "ok", ""),
        "docker context show": (0, "colima", ""),
        "docker ps --format {{.Names}}": (0, "cloudflared\npihole", ""),
        "docker inspect cloudflared": (0, healthy_inspect_json, ""),
    }
    monkeypatch.setattr(dns, "_run", fake_run_factory(mapping))
    res = dns.cloudflared_status_check()
    assert res.success is True
    assert any(m[0] == Severity.INFO and "Health: healthy" in m[1] for m in res.messages)


def test_cloudflared_unhealthy_reports_probe(monkeypatch, unhealthy_inspect_json):
    stub_engine(monkeypatch, "docker")
    mapping = {
        "docker info": (0, "ok", ""),
        "docker context show": (0, "colima", ""),
        "docker ps --format {{.Names}}": (0, "cloudflared", ""),
        "docker inspect cloudflared": (0, unhealthy_inspect_json, ""),
    }
    monkeypatch.setattr(dns, "_run", fake_run_factory(mapping))
    res = dns.cloudflared_status_check()
    assert res.success is False
    assert any(m[0] == Severity.ERROR and "Unhealthy last probe" in m[1] for m in res.messages)


def test_not_running_shows_hint(monkeypatch):
    stub_engine(monkeypatch, "docker")
    mapping = {
        "docker info": (0, "ok", ""),
        "docker context show": (0, "colima", ""),
        "docker ps --format {{.Names}}": (0, "", ""),  # nothing running
        "docker inspect cloudflared": (1, "", "not found"),
    }
    monkeypatch.setattr(dns, "_run", fake_run_factory(mapping))
    res = dns.cloudflared_status_check()
    assert res.success is False
    assert any(m[0] == Severity.HINT for m in res.messages)


def test_context_mismatch_warns(monkeypatch, healthy_inspect_json):
    stub_engine(monkeypatch, "docker")
    mapping = {
        "docker info": (0, "ok", ""),
        "docker context show": (0, "default", ""),
        "docker ps --format {{.Names}}": (0, "cloudflared", ""),
        "docker inspect cloudflared": (0, healthy_inspect_json, ""),
    }
    monkeypatch.setattr(dns, "_run", fake_run_factory(mapping))
    res = dns.cloudflared_status_check()
    assert any(m[0] == Severity.WARNING for m in res.messages)


def test_podman_fallback(monkeypatch, healthy_inspect_json):
    # Docker not available, Podman available
    monkeypatch.setattr(dns, "_cmd_exists", lambda n: (n == "podman"))
    monkeypatch.setattr(dns, "_engine_name", lambda: "podman")
    mapping = {
        "podman info": (0, "ok", ""),
        "podman ps --format {{.Names}}": (0, "cloudflared", ""),
        "podman inspect cloudflared": (0, healthy_inspect_json, ""),
    }
    monkeypatch.setattr(dns, "_run", fake_run_factory(mapping))
    res = dns.cloudflared_status_check()
    # No context warnings for podman and success true
    assert res.success is True
    assert not any("context" in m[1] for _, m in res.messages)


def test_dns_sanity_conflicts(monkeypatch):
    # Force Linux path so the command stub is deterministic in CI.
    monkeypatch.setattr(dns.platform, "system", lambda: "Linux")
    # ps shows processes; port 53 shows a binder
    mapping = {
        "ps aux": (0, "root 1 0 0 cloudflared --something\n", ""),
        "ss -tunlp": (0, "udp   UNCONN 0 0 0.0.0.0:53 0.0.0.0:* users:((\"dnsmasq\"))", ""),
    }
    monkeypatch.setattr(dns, "_run", fake_run_factory(mapping))
    res = dns.dns_sanity_check()
    assert res.success is False
    assert any(m[0] == Severity.ERROR and "port 53" in m[1] for m in res.messages)
