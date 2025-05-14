import subprocess


def test_nlx_help():
    # Run the help command and capture output
    completed = subprocess.run(
        ["poetry", "run", "nlx", "--help"], capture_output=True, text=True
    )
    output = completed.stdout
    assert "Usage:" in output
    assert "run" in output
