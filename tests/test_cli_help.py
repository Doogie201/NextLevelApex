from typer.testing import CliRunner

from nextlevelapex.main import app


def test_nlx_help():
    """nlx --help should display key commands and exit cleanly."""

    runner = CliRunner()
    result = runner.invoke(app, ["--help"])

    assert result.exit_code == 0
    output = result.stdout
    assert "Usage:" in output
    assert "run" in output
    assert "generate-config" in output
    assert "diagnose" in output
