from __future__ import annotations

import pytest
from typer.testing import CliRunner

import nextlevelapex.main2 as main2
from nextlevelapex.core.dns_diagnose import DiagnoseSummary

runner = CliRunner()


@pytest.mark.parametrize(
    ("exit_code", "cloudflared"),
    [
        (0, "ok"),
        (1, "down"),
        (2, "down"),
    ],
)
def test_diagnose_without_task_prints_single_line_and_exits(monkeypatch, exit_code, cloudflared):
    summary = DiagnoseSummary(
        dns_mode="local-private",
        resolver="192.168.64.2",
        pihole="running",
        pihole_upstream="host.docker.internal#5053",
        cloudflared=cloudflared,
        plaintext_dns="no",
        notes="ok",
        exit_code=exit_code,
    )
    monkeypatch.setattr(main2, "collect_dns_summary", lambda: summary)

    result = runner.invoke(main2.app, ["diagnose"])

    assert result.exit_code == exit_code
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    assert len(lines) == 1
    assert lines[0].startswith("DNS_MODE=local-private ")
    assert 'NOTES="ok"' in lines[0]
