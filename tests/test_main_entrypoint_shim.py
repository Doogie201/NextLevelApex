import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

REPO_ROOT = Path(__file__).resolve().parents[1]


def _run_module(module: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", module, *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def _run_cmd(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_module_main_help_works():
    result = _run_module("nextlevelapex.main", "--help")
    assert result.returncode == 0
    assert "NextLevelApex Orchestrator" in result.stdout


def test_module_main_legacy_run_alias_keeps_help_working():
    result = _run_module("nextlevelapex.main", "run", "--help")
    assert result.returncode == 0
    assert "NextLevelApex Orchestrator" in result.stdout


def test_main_shim_forwards_legacy_run_args(monkeypatch):
    import nextlevelapex.main as main_entry

    captured: dict[str, object] = {}

    def fake_app(*, prog_name: str, args: list[str]) -> None:
        captured["prog_name"] = prog_name
        captured["args"] = args

    monkeypatch.setattr(main_entry, "_load_canonical_app", lambda: fake_app)

    code = main_entry.main(["run", "--dry-run", "--no-reports"])
    assert code == 0
    assert captured["prog_name"] == "python -m nextlevelapex.main"
    assert captured["args"] == ["--dry-run", "--no-reports"]


def test_main_shim_has_no_orchestrator_implementation():
    src = (REPO_ROOT / "nextlevelapex" / "main.py").read_text()
    forbidden_markers = (
        "def discover_tasks(",
        "def run_task(",
        "@app.command",
        "@app.callback",
        "mark_section_complete(",
        "update_task_health(",
    )
    for marker in forbidden_markers:
        assert marker not in src


def test_cli_help_equivalence_nlx_and_main2_module():
    if shutil.which("nlx") is None:
        pytest.skip("nlx script not available in PATH")

    nlx_help = _run_cmd("nlx", "--help")
    main2_help = _run_module("nextlevelapex.main2", "--help")

    assert nlx_help.returncode == 0
    assert main2_help.returncode == 0

    key_tokens = (
        "NextLevelApex Orchestrator",
        "install-sudoers",
        "export-state",
        "auto-fix",
        "task-info",
    )
    for token in key_tokens:
        assert token in nlx_help.stdout
        assert token in main2_help.stdout


def test_main2_dry_run_only_known_task_dispatches_without_attrerror(monkeypatch):
    import nextlevelapex.main2 as main2

    calls: list[dict] = []

    def fake_task(ctx: dict) -> dict:
        calls.append(ctx)
        return {"status": "PASS", "details": "ok"}

    state = {
        "version": "2.0",
        "last_run_status": "UNKNOWN",
        "completed_sections": [],
        "failed_sections": [],
        "task_status": {},
        "file_hashes": {},
        "health_history": {},
        "service_versions": {},
        "last_report_path": None,
    }

    def fake_load_config() -> dict:
        return {}

    def fake_discover_files_for_hashing() -> list:
        return []

    monkeypatch.setattr(main2, "discover_tasks", lambda: {"Known Task": fake_task})
    monkeypatch.setattr(main2, "load_state", lambda _path: state)
    monkeypatch.setattr(main2, "load_config", fake_load_config)
    monkeypatch.setattr(main2, "discover_files_for_hashing", fake_discover_files_for_hashing)
    monkeypatch.setattr(main2, "save_state", lambda *_a, **_k: True)

    runner = CliRunner()
    result = runner.invoke(main2.app, ["--dry-run", "--no-reports", "--task", "Known"])
    assert result.exit_code == 0, result.output
    assert "AttributeError" not in result.output
    assert len(calls) == 1
