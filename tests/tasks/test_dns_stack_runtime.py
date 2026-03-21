from __future__ import annotations

from pathlib import Path

import nextlevelapex.tasks.dns_stack_runtime as runtime
from nextlevelapex.core.task import Severity


def _settings(config: dict | None = None):
    settings, _ = runtime.load_dns_settings(config or {})
    return settings


def test_needs_temporary_dns_release_only_for_disruptive_expected_resolver():
    assert runtime.needs_temporary_dns_release(["192.168.64.2"], True, False) is True
    assert runtime.needs_temporary_dns_release(["192.168.64.2"], False, True) is True
    assert runtime.needs_temporary_dns_release(["192.168.64.2"], False, False) is False
    assert runtime.needs_temporary_dns_release(["8.8.8.8"], True, True) is False


def test_inspect_pihole_container_detects_image_drift(monkeypatch):
    settings = _settings()
    monkeypatch.setattr(
        runtime,
        "inspect_container",
        lambda name: {
            "Config": {"Image": "pihole/pihole:latest"},
            "HostConfig": {
                "PortBindings": {
                    "53/tcp": [{"HostIp": settings.resolver_ip, "HostPort": "53"}],
                    "53/udp": [{"HostIp": settings.resolver_ip, "HostPort": "53"}],
                    "80/tcp": [
                        {"HostIp": settings.resolver_ip, "HostPort": str(settings.pihole_web_port)}
                    ],
                },
                "RestartPolicy": {"Name": "unless-stopped"},
            },
            "State": {"Running": True, "Health": {"Status": "healthy"}},
        },
    )

    summary = runtime.inspect_pihole_container(settings)

    assert summary["present"] is True
    assert summary["recreate_required"] is True


def test_render_launch_agent_uses_configured_upstreams():
    settings = _settings(
        {
            "networking": {
                "cloudflared_host_agent": {
                    "upstreams": ["https://one.example/dns-query", "https://two.example/dns-query"],
                }
            }
        }
    )

    rendered = runtime.render_launch_agent(settings, settings.cloudflared_binary_path)

    assert "<string>https://one.example/dns-query</string>" in rendered
    assert "<string>https://two.example/dns-query</string>" in rendered


def test_cloudflared_release_url_targets_exact_darwin_asset(monkeypatch):
    settings = _settings()
    monkeypatch.setattr(runtime.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(runtime.platform, "machine", lambda: "arm64")

    assert runtime.cloudflared_release_asset_name() == "cloudflared-darwin-arm64.tgz"
    assert runtime.cloudflared_release_url(settings) == (
        "https://github.com/cloudflare/cloudflared/releases/download/2025.5.0/"
        "cloudflared-darwin-arm64.tgz"
    )


def test_ensure_cloudflared_binary_reuses_exact_preferred_binary(monkeypatch, tmp_path):
    preferred = tmp_path / "cloudflared"
    preferred.write_text("binary", encoding="utf-8")
    settings = _settings(
        {
            "networking": {
                "cloudflared_host_agent": {
                    "binary_path": str(preferred),
                }
            }
        }
    )

    monkeypatch.setattr(
        runtime,
        "cloudflared_version",
        lambda binary=None: (
            settings.cloudflared_required_version if Path(str(binary)) == preferred else None
        ),
    )
    monkeypatch.setattr(runtime, "is_brew_formula_installed", lambda formula: False)

    result = runtime.ensure_cloudflared_binary(settings)

    assert result.success is True
    assert result.changed is False
    assert result.path == preferred
    assert result.source == "preferred"


def test_ensure_cloudflared_binary_dry_run_reports_bootstrap(monkeypatch, tmp_path):
    settings = _settings(
        {
            "networking": {
                "cloudflared_host_agent": {
                    "binary_path": str(tmp_path / "missing-cloudflared"),
                    "bootstrap_bin_dir": str(tmp_path / "bin"),
                    "bootstrap_cache_dir": str(tmp_path / "cache"),
                }
            }
        }
    )

    monkeypatch.setattr(runtime.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(runtime.platform, "machine", lambda: "arm64")
    monkeypatch.setattr(runtime, "cloudflared_version", lambda binary=None: None)

    result = runtime.ensure_cloudflared_binary(settings, dry_run=True)

    assert result.success is True
    assert result.changed is True
    assert result.evidence["bootstrap_release_url"].endswith("cloudflared-darwin-arm64.tgz")
    assert any("Would bootstrap cloudflared 2025.5.0" in text for _, text in result.messages)


def test_orchestrate_dns_stack_releases_dns_before_disruptive_changes(monkeypatch):
    calls: list[tuple[str, tuple[str, ...]]] = []
    snapshots = iter(
        [
            {
                "active_service": "Wi-Fi",
                "configured_resolvers": ["192.168.64.2"],
                "docker_context": "colima",
                "colima": {"running": True, "ip_address": "192.168.64.2"},
                "containers": ["pihole"],
                "default_server": "SERVER: 192.168.64.2#53",
                "connectivity": "HTTP/2 200",
                "listeners": "",
            },
            {
                "active_service": "Wi-Fi",
                "configured_resolvers": ["192.168.64.2"],
                "docker_context": "colima",
                "colima": {"running": True, "ip_address": "192.168.64.2"},
                "containers": ["pihole"],
                "default_server": "SERVER: 192.168.64.2#53",
                "connectivity": "HTTP/2 200",
                "listeners": "",
            },
        ]
    )

    monkeypatch.setattr(runtime, "capture_runtime_snapshot", lambda: next(snapshots))
    monkeypatch.setattr(
        runtime, "inspect_colima_runtime", lambda settings: {"restart_required": True}
    )
    monkeypatch.setattr(
        runtime, "inspect_pihole_container", lambda settings: {"recreate_required": True}
    )
    monkeypatch.setattr(
        runtime,
        "set_network_service_dns",
        lambda service, servers, dry_run=False: calls.append((service, tuple(servers)))
        or runtime.StepResult(
            True,
            changed=True,
            messages=[(Severity.INFO, f"set {service}")],
            evidence={},
        ),
    )
    monkeypatch.setattr(
        runtime,
        "ensure_cloudflared_service",
        lambda settings, dry_run=False: runtime.StepResult(True),
    )
    monkeypatch.setattr(
        runtime,
        "ensure_colima_runtime",
        lambda config, settings, dry_run=False: runtime.StepResult(True),
    )
    monkeypatch.setattr(
        runtime, "ensure_docker_context_colima", lambda dry_run=False: runtime.StepResult(True)
    )
    monkeypatch.setattr(
        runtime, "remove_legacy_containers", lambda dry_run=False: runtime.StepResult(True)
    )
    monkeypatch.setattr(
        runtime, "ensure_pihole_container", lambda settings, dry_run=False: runtime.StepResult(True)
    )
    monkeypatch.setattr(
        runtime,
        "validate_dns_stack",
        lambda settings, require_default_resolver: runtime.StepResult(
            True,
            messages=[(Severity.INFO, "validated")],
            evidence={"require_default_resolver": require_default_resolver},
        ),
    )

    result = runtime.orchestrate_dns_stack({"networking": {"set_system_dns": True}}, dry_run=False)

    assert result.success is True
    assert calls[0] == ("Wi-Fi", ())
    assert calls[-1] == ("Wi-Fi", ("192.168.64.2",))
