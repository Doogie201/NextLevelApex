import pytest

from nextlevelapex.core.task import Severity, TaskResult
from nextlevelapex.tasks.dev_tools import setup_colima_task


class DummyCtx(dict):
    def __init__(self, config_override=None, dry_run=True):
        super().__init__()
        self["dry_run"] = dry_run
        self["verbose"] = False
        self["config"] = {
            "developer_tools": {
                "mise": {},
                "docker_runtime": {
                    "provider": "colima",
                    "colima": {
                        "start_on_run": True,
                        "vm_arch": "aarch64",
                        "vm_type": "vz",
                        "vz_rosetta": True,
                        "cpu": 2,
                        "memory": 4,
                        "disk": 50,
                    },
                },
            }
        }

        if config_override:
            self["config"].update(config_override)


@pytest.mark.parametrize("dry_run", [True, False])
def test_colima_task_runs_with_colima_provider(monkeypatch, dry_run):
    """Colima setup should succeed if dry_run or status is mocked to success."""
    # Pretend `colima status` shows it's already running
    monkeypatch.setattr(
        "nextlevelapex.tasks.dev_tools.run_command",
        lambda cmd, **kwargs: type(
            "MockResult",
            (),
            {
                "success": True,
                "returncode": 0,
                "stdout": "colima is running",
                "stderr": "",
            },
        )(),
    )

    ctx = DummyCtx(dry_run=dry_run)
    result: TaskResult = setup_colima_task(ctx)

    assert isinstance(result, TaskResult)
    assert result.success is True
    if not dry_run:
        assert result.changed is True
    else:
        assert result.changed is False
    assert not any(sev == Severity.ERROR for sev, _ in result.messages)


def test_colima_task_skips_if_not_colima_provider():
    ctx = DummyCtx(
        config_override={
            "developer_tools": {"docker_runtime": {"provider": "docker-desktop"}}
        },
        dry_run=True,
    )
    result = setup_colima_task(ctx)
    assert result.success is True
    assert result.changed is False
    assert all(sev != Severity.ERROR for sev, _ in result.messages)


def test_colima_task_fails_if_status_check_fails(monkeypatch):
    call_log = []

    def mock_run_command(cmd, **kwargs):
        call_log.append(cmd)
        if cmd[:2] == ["colima", "start"]:
            return type(
                "MockResult",
                (),
                {
                    "success": False,
                    "returncode": 1,
                    "stdout": "",
                    "stderr": "failed to start",
                },
            )()
        elif cmd[:2] == ["colima", "status"]:
            # Simulate a successful run, but with missing expected keywords
            return type(
                "MockResult",
                (),
                {
                    "success": True,
                    "returncode": 0,
                    "stdout": "some unrelated output",
                    "stderr": "",
                },
            )()
        return type(
            "MockResult",
            (),
            {"success": True, "returncode": 0, "stdout": "", "stderr": ""},
        )()

    monkeypatch.setattr("nextlevelapex.tasks.dev_tools.run_command", mock_run_command)

    ctx = DummyCtx(dry_run=False)
    result: TaskResult = setup_colima_task(ctx)

    assert isinstance(result, TaskResult)
    assert result.success is False
    assert result.changed is False
    assert any("Failed to set up Colima VM" in msg for _, msg in result.messages)
