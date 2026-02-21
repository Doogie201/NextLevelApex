import ast
from pathlib import Path

from typer.testing import CliRunner

from nextlevelapex.main2 import app

runner = CliRunner()


def test_export_state_rejects_yaml():
    result = runner.invoke(app, ["export-state", "--fmt", "yaml"])
    assert result.exit_code == 1
    assert "ERROR: Unsupported export format. Allowed formats: json, csv." in result.output


def test_export_state_rejects_unknown_format_with_same_error():
    result = runner.invoke(app, ["export-state", "--fmt", "xml"])
    assert result.exit_code == 1
    assert "ERROR: Unsupported export format. Allowed formats: json, csv." in result.output


def test_no_shell_true_in_source_code():
    """
    Scans all .py files in the nextlevelapex/ module to ensure nobody
    introduces `shell=True` into subprocess calls.
    We parse the AST looking for Call nodes with keyword `shell` set to True.
    """
    project_root = Path(__file__).parent.parent.parent
    src_dir = project_root / "nextlevelapex"

    violations = []

    for py_file in src_dir.rglob("*.py"):
        try:
            tree = ast.parse(py_file.read_text(), filename=str(py_file))
        except SyntaxError:
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                violations.extend(
                    f"{py_file.relative_to(project_root)}:{node.lineno}"
                    for kw in node.keywords
                    if kw.arg == "shell"
                    and isinstance(kw.value, ast.Constant)
                    and kw.value.value is True
                )

    assert not violations, f"Found restricted 'shell=True' invocations in: {violations}"
