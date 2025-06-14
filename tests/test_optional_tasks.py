import pytest

from nextlevelapex.core.task import Severity, TaskResult
from nextlevelapex.tasks.optional import setup_yubikey_ssh_task


class DummyCtx(dict):
    def __init__(self, dry_run=True):
        super().__init__()
        self["dry_run"] = dry_run
        self["config"] = {}


@pytest.mark.parametrize(
    "mock_return,dry_run,expect_changed",
    [
        (True, False, True),
        (True, True, False),
        (False, False, False),
        (False, True, False),
    ],
)
def test_setup_yubikey_ssh_task(monkeypatch, mock_return, dry_run, expect_changed):
    monkeypatch.setattr(
        "nextlevelapex.tasks.optional.setup_yubikey_ssh", lambda config, dry_run: mock_return
    )
    ctx = DummyCtx(dry_run=dry_run)
    result: TaskResult = setup_yubikey_ssh_task(ctx)

    assert isinstance(result, TaskResult)
    assert result.success == mock_return
    assert result.changed == expect_changed
    if not mock_return:
        assert any(sev == Severity.WARNING for sev, _ in result.messages)
    else:
        assert result.messages == []
