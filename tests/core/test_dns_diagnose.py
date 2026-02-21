from __future__ import annotations

from nextlevelapex.core.dns_diagnose import CommandResult, collect_dns_summary, render_dns_summary


def _runner(mapping: dict[tuple[str, ...], CommandResult | None]):
    def _run(cmd: list[str], timeout: int = 2) -> CommandResult | None:
        _ = timeout
        return mapping.get(tuple(cmd))

    return _run


def test_collect_dns_summary_ok_case():
    mapping = {
        ("networksetup", "-getdnsservers", "Wi-Fi"): CommandResult(0, "192.168.64.2\n", ""),
        ("scutil", "--dns"): CommandResult(0, "resolver #1\n  nameserver[0] : 192.168.64.2\n", ""),
        (
            "dig",
            "+time=1",
            "+tries=1",
            "+short",
            "@127.0.0.1",
            "-p",
            "5053",
            "example.com",
        ): CommandResult(0, "93.184.216.34\n", ""),
        ("docker", "ps", "--format", "{{.Names}}"): CommandResult(0, "pihole\n", ""),
        ("docker", "exec", "pihole", "pihole-FTL", "--config", "dns.upstreams"): CommandResult(
            0, "[ host.docker.internal#5053 ]\n", ""
        ),
    }

    summary = collect_dns_summary(_runner(mapping))

    assert summary.exit_code == 0
    assert summary.dns_mode == "local-private"
    assert summary.resolver == "192.168.64.2"
    assert summary.pihole == "running"
    assert summary.cloudflared == "ok"
    assert summary.plaintext_dns == "no"
    assert render_dns_summary(summary).startswith("DNS_MODE=local-private ")


def test_collect_dns_summary_degraded_when_cloudflared_down():
    mapping = {
        ("networksetup", "-getdnsservers", "Wi-Fi"): CommandResult(0, "192.168.64.2\n", ""),
        ("scutil", "--dns"): CommandResult(0, "resolver #1\n  nameserver[0] : 192.168.64.2\n", ""),
        (
            "dig",
            "+time=1",
            "+tries=1",
            "+short",
            "@127.0.0.1",
            "-p",
            "5053",
            "example.com",
        ): CommandResult(9, "", "timeout"),
        ("docker", "ps", "--format", "{{.Names}}"): CommandResult(0, "pihole\n", ""),
        ("docker", "exec", "pihole", "pihole-FTL", "--config", "dns.upstreams"): CommandResult(
            0, "[ host.docker.internal#5053 ]\n", ""
        ),
    }

    summary = collect_dns_summary(_runner(mapping))

    assert summary.exit_code == 1
    assert summary.cloudflared == "down"


def test_collect_dns_summary_broken_on_wrong_resolver_and_missing_pihole():
    mapping = {
        ("networksetup", "-getdnsservers", "Wi-Fi"): CommandResult(0, "172.17.0.1\n", ""),
        ("scutil", "--dns"): CommandResult(0, "resolver #1\n  nameserver[0] : 172.17.0.1\n", ""),
        (
            "dig",
            "+time=1",
            "+tries=1",
            "+short",
            "@127.0.0.1",
            "-p",
            "5053",
            "example.com",
        ): CommandResult(0, "93.184.216.34\n", ""),
        ("docker", "ps", "--format", "{{.Names}}"): CommandResult(0, "", ""),
    }

    summary = collect_dns_summary(_runner(mapping))

    assert summary.exit_code == 2
    assert summary.resolver == "172.17.0.1"
    assert summary.pihole == "missing"
    assert "resolver-pihole-mismatch" in summary.notes
