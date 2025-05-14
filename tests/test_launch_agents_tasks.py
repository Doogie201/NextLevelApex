import pytest

from nextlevelapex.core.registry import get_task_registry
from nextlevelapex.core.task import Severity, TaskResult
from nextlevelapex.tasks.launch_agents import setup_battery_alert_agent_task


class DummyCtx(dict):
    def __init__(self, dry_run=True):
        super().__init__()
        self["dry_run"] = dry_run
        self["config"] = {}


def test_launch_agents_in_registry():
    """Ensure our launch agents wrappers are registered correctly."""
    get_task_registry()
    names = list(get_task_registry().keys())
    assert "Battery Alert Agent" in names
    assert "Weekly Audit Agent" in names


@pytest.mark.parametrize(
    "mock_return,dry_run,expect_success,expect_changed",
    [
        (True, False, True, True),
        (False, True, False, False),
    ],
)
def test_battery_alert_agent_task(
    monkeypatch, mock_return, dry_run, expect_success, expect_changed
):
    """Test the battery alert agent wrapper with both success and failure conditions."""
    # Patch the underlying implementation to return mock_return
    monkeypatch.setattr(
        "nextlevelapex.tasks.launch_agents.setup_battery_alert_agent",
        lambda config, dry_run: mock_return,
    )
    ctx = DummyCtx(dry_run=dry_run)
    result: TaskResult = setup_battery_alert_agent_task(ctx)
    assert isinstance(result, TaskResult)
    assert result.success == expect_success
    assert result.changed == expect_changed
    if not expect_success:
        # On failure, there should be an ERROR message
        assert any(sev == Severity.ERROR for sev, _ in result.messages)
    else:
        # On success, messages list should be empty
        assert result.messages == []
