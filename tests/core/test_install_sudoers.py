from unittest.mock import patch

from typer.testing import CliRunner

from nextlevelapex.main2 import app

runner = CliRunner()


def test_install_sudoers_no_interface():
    # Calling without --interface should fail cleanly
    with patch("subprocess.run") as mock_run:

        class DummyProcess:
            stdout = "An asterisk (*)\nWi-Fi\n*Disabled"
            returncode = 0
            stderr = ""

        mock_run.return_value = DummyProcess()

        result = runner.invoke(app, ["install-sudoers"])

        assert result.exit_code == 1
        assert "ERROR: --interface argument is required" in result.output
        assert "Wi-Fi" in result.output


def test_install_sudoers_invalid_interface():
    # Calling with invalid interface should fail cleanly
    with patch("subprocess.run") as mock_run:

        class DummyProcess:
            stdout = "An asterisk (*)\nWi-Fi\n*Disabled"
            returncode = 0
            stderr = ""

        mock_run.return_value = DummyProcess()

        result = runner.invoke(app, ["install-sudoers", "--interface", "FakeNet"])

        assert result.exit_code == 1
        assert "ERROR: Interface 'FakeNet' is not a valid active network service" in result.output
        assert "Wi-Fi" in result.output


def test_install_sudoers_unsafe_interface_chars():
    # Calling with valid interface but injecting unsafe chars
    with patch("subprocess.run") as mock_run:

        class DummyProcess:
            stdout = "An asterisk (*)\nWi-Fi,\n*Disabled"
            returncode = 0
            stderr = ""

        mock_run.return_value = DummyProcess()

        result = runner.invoke(app, ["install-sudoers", "--interface", "Wi-Fi,"])

        assert result.exit_code == 1
        assert "contains characters unsafe for sudoers" in result.output


@patch("tempfile.NamedTemporaryFile")
def test_install_sudoers_safe_generation_and_no_shell(mock_tempfile):
    # Tests generation passes cleanly without shell=True in any subprocess calls
    with patch("subprocess.run") as mock_run:

        class DummyProcess:
            stdout = "An asterisk (*)\nMy Wi-Fi\n*Disabled"
            returncode = 0
            stderr = ""

        mock_run.return_value = DummyProcess()

        class DummyFile:
            name = "/tmp/dummy"
            written_data = ""

            def write(self, data):
                self.written_data = data

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

        mock_tf = DummyFile()
        mock_tempfile.return_value = mock_tf

        with patch("pathlib.Path.unlink"):
            result = runner.invoke(app, ["install-sudoers", "--interface", "My Wi-Fi"])

            assert result.exit_code == 0

            # 1. Verify safe generation (escaped spaces)
            assert "My\\ Wi-Fi" in mock_tf.written_data
            assert "ALL=(ALL) NOPASSWD" in mock_tf.written_data

            # 2. Verify no shell=True is ever used across all 4 system calls
            for call_args in mock_run.call_args_list:
                args, kwargs = call_args
                assert kwargs.get("shell") is not True, "shell=True was encountered!"
                assert isinstance(args[0], list), "Subprocess args must be arrays, not strings"
