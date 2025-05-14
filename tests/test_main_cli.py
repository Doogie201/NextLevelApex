from typer.testing import CliRunner

from nextlevelapex.core.registry import task
from nextlevelapex.main import app, get_task_registry

runner = CliRunner()


def test_cli_runs_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "NextLevelApex" in result.stdout
