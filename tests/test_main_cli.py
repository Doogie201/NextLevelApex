from typer.testing import CliRunner

from nextlevelapex.main import app

runner = CliRunner()


def test_cli_runs_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "NextLevelApex" in result.stdout
