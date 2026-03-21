import ast
import re
import tomllib
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


def test_cli_runtime_dependencies_are_part_of_default_install_contract():
    project_root = Path(__file__).parent.parent.parent
    pyproject = tomllib.loads((project_root / "pyproject.toml").read_text())

    poetry = pyproject["tool"]["poetry"]
    dependencies = poetry["dependencies"]
    extras = poetry.get("extras", {})
    extra_values = {dep_name for values in extras.values() for dep_name in values}

    assert poetry["scripts"]["nlx"] == "nextlevelapex.main2:app"
    assert "typer" in dependencies
    assert "typer" not in extra_values


def test_poetry_lock_keeps_cli_runtime_unconditional():
    project_root = Path(__file__).parent.parent.parent
    poetry_lock = (project_root / "poetry.lock").read_text()
    poetry_lock_data = tomllib.loads(poetry_lock)
    lock_extras = poetry_lock_data.get("extras", {})
    extra_values = {dep_name for values in lock_extras.values() for dep_name in values}

    def package_block(name: str) -> str:
        match = re.search(
            rf'\[\[package\]\]\nname = "{name}"\n.*?(?=\n\[\[package\]\]\n|\Z)',
            poetry_lock,
            re.S,
        )
        assert match, f"package {name} not found in poetry.lock"
        return match.group(0)

    typer_block = package_block("typer")
    shellingham_block = package_block("shellingham")

    assert "cli" not in lock_extras
    assert "typer" not in extra_values
    assert "shellingham" not in extra_values
    assert 'markers = "extra == \\"cli\\""' not in typer_block
    assert 'markers = "extra == \\"cli\\""' not in shellingham_block
