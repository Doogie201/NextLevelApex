import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from nextlevelapex.main2 import (
    _parse_network_services,
    _read_sudoers_content_for_check,
    _render_sudoers_rule,
    _sudoers_escape_arg,
    _sudoers_includedir_present,
    _validate_interface_name,
    app,
)

runner = CliRunner()


def test_install_sudoers_non_darwin_gate(monkeypatch):
    monkeypatch.setattr("nextlevelapex.main2.sys.platform", "linux")
    result = runner.invoke(app, ["install-sudoers", "--interface", "Wi-Fi"])
    assert result.exit_code == 1
    assert "only supported on macOS (darwin)" in result.output


def test_parse_network_services_strips_and_keeps_spaces():
    output = (
        "An asterisk (*) denotes that a network service is disabled.\n"
        " Wi-Fi \n"
        "USB 10/100/1000 LAN\n"
        "  *Thunderbolt Bridge\n"
        "*Bluetooth PAN\n"
        "My Service Name\n"
    )
    assert _parse_network_services(output) == ["Wi-Fi", "USB 10/100/1000 LAN", "My Service Name"]


def test_validate_interface_allows_spaces():
    _validate_interface_name("My Wi-Fi", ["Wi-Fi", "My Wi-Fi"])


@pytest.mark.parametrize(
    "unsafe",
    [
        "Wi-Fi,",
        "Wi-Fi\n",
        "Wi-Fi\t",
        'Wi-"Fi',
        "Wi-'Fi",
        "Wi/Fi",
        r"Wi-\Fi",
    ],
)
def test_validate_interface_rejects_unsafe_characters(unsafe):
    with pytest.raises(ValueError):
        _validate_interface_name(unsafe, [unsafe])


@pytest.mark.parametrize("bad", ["bad\n", "bad\r", "bad\t", "bad,", 'bad"', "bad'", "bad\0"])
def test_sudoers_escape_rejects_forbidden_characters(bad):
    with pytest.raises(ValueError, match="Invalid character in sudoers argument"):
        _sudoers_escape_arg(bad)


def test_sudoers_rule_render_is_stable_and_single_line():
    rendered = _render_sudoers_rule("alice", "My Wi-Fi")
    expected = (
        "alice ALL=(root) NOPASSWD: "
        "/usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on, "
        "/usr/sbin/networksetup -setdnsservers My\\ Wi-Fi 127.0.0.1, "
        "/usr/sbin/networksetup -setdnsservers My\\ Wi-Fi Empty\n"
    )
    assert rendered == expected
    assert rendered.endswith("\n")
    assert rendered.count("\n") == 1


def test_sudoers_includedir_parser_handles_whitespace_and_comments():
    content = """
Defaults        env_reset
   #includedir    /private/etc/sudoers.d   # comment
#includedir /etc/sudoers.d
"""
    assert _sudoers_includedir_present(content) is True


def test_sudoers_includedir_parser_rejects_other_paths():
    content = "#includedir /tmp/not-allowed\n"
    assert _sudoers_includedir_present(content) is False


def test_read_sudoers_content_permissionerror_falls_back_to_sudo_cat(monkeypatch):
    monkeypatch.setattr(
        Path, "read_text", lambda self, *a, **k: (_ for _ in ()).throw(PermissionError())
    )

    def fake_run(cmd, **kwargs):
        assert cmd == ["sudo", "-n", "cat", "/etc/sudoers"]
        assert kwargs.get("shell") is not True
        assert kwargs.get("timeout") == 5
        return subprocess.CompletedProcess(cmd, 0, stdout="#includedir /etc/sudoers.d\n", stderr="")

    monkeypatch.setattr("nextlevelapex.main2.subprocess.run", fake_run)
    assert _read_sudoers_content_for_check() == "#includedir /etc/sudoers.d\n"


def test_read_sudoers_content_permissionerror_denied_returns_none(monkeypatch):
    monkeypatch.setattr(
        Path, "read_text", lambda self, *a, **k: (_ for _ in ()).throw(PermissionError())
    )

    def fake_run(cmd, **kwargs):
        assert cmd == ["sudo", "-n", "cat", "/etc/sudoers"]
        assert kwargs.get("timeout") == 5
        return subprocess.CompletedProcess(
            cmd,
            1,
            stdout="",
            stderr="sudo: a password is required",
        )

    monkeypatch.setattr("nextlevelapex.main2.subprocess.run", fake_run)
    assert _read_sudoers_content_for_check() is None


def test_read_sudoers_content_permissionerror_sudo_unavailable_returns_none(monkeypatch):
    monkeypatch.setattr(
        Path, "read_text", lambda self, *a, **k: (_ for _ in ()).throw(PermissionError())
    )
    monkeypatch.setattr(
        "nextlevelapex.main2.subprocess.run", lambda *a, **k: (_ for _ in ()).throw(OSError())
    )
    assert _read_sudoers_content_for_check() is None


def test_read_sudoers_content_permissionerror_sudo_timeout_returns_none(monkeypatch):
    monkeypatch.setattr(
        Path, "read_text", lambda self, *a, **k: (_ for _ in ()).throw(PermissionError())
    )

    def fake_run(*a, **k):
        raise subprocess.TimeoutExpired(cmd=["sudo", "-n", "cat", "/etc/sudoers"], timeout=5)

    monkeypatch.setattr("nextlevelapex.main2.subprocess.run", fake_run)
    assert _read_sudoers_content_for_check() is None


def test_install_sudoers_happy_path_no_shell_and_reads_sudoers(monkeypatch):
    monkeypatch.setattr("nextlevelapex.main2.sys.platform", "darwin")
    monkeypatch.setattr("getpass.getuser", lambda: "alice")

    calls: list[tuple[list[str], dict]] = []
    visudo_temp_path: Path | None = None
    visudo_rendered: str | None = None

    def fake_run(cmd, **kwargs):
        nonlocal visudo_temp_path
        nonlocal visudo_rendered
        calls.append((cmd, kwargs))
        assert kwargs.get("shell") is not True
        assert isinstance(cmd, list)
        if cmd == ["networksetup", "-listallnetworkservices"]:
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout=(
                    "An asterisk (*) denotes that a network service is disabled.\n"
                    "Wi-Fi\n"
                    "My Wi-Fi\n"
                ),
                stderr="",
            )
        if len(cmd) >= 4 and cmd[:3] == ["visudo", "-c", "-f"]:
            assert kwargs.get("timeout") == 5
            visudo_temp_path = Path(cmd[3])
            visudo_rendered = visudo_temp_path.read_text()
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        if cmd[:2] == ["sudo", "install"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        raise AssertionError(f"Unexpected subprocess call: {cmd}")

    original_read_text = Path.read_text

    def fake_read_text(path_obj: Path, *args, **kwargs):
        if str(path_obj) == "/etc/sudoers":
            return "#includedir /private/etc/sudoers.d\n"
        return original_read_text(path_obj, *args, **kwargs)

    monkeypatch.setattr("nextlevelapex.main2.subprocess.run", fake_run)
    monkeypatch.setattr(Path, "read_text", fake_read_text)

    result = runner.invoke(app, ["install-sudoers", "--interface", "My Wi-Fi"])
    assert result.exit_code == 0
    assert visudo_temp_path is not None
    assert visudo_rendered is not None

    assert "My\\ Wi-Fi" in visudo_rendered
    assert visudo_rendered.endswith("\n")
    assert visudo_rendered.count("\n") == 1
    assert any(call[0][:2] == ["sudo", "install"] for call in calls)


def test_install_sudoers_fails_when_sudoers_include_missing(monkeypatch):
    monkeypatch.setattr("nextlevelapex.main2.sys.platform", "darwin")
    monkeypatch.setattr("getpass.getuser", lambda: "alice")

    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        assert kwargs.get("shell") is not True
        if cmd == ["networksetup", "-listallnetworkservices"]:
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout="An asterisk (*) denotes that a network service is disabled.\nWi-Fi\n",
                stderr="",
            )
        raise AssertionError(f"Unexpected subprocess call: {cmd}")

    monkeypatch.setattr("nextlevelapex.main2.subprocess.run", fake_run)
    monkeypatch.setattr(Path, "read_text", lambda self, *a, **k: "# no includedir here\n")

    result = runner.invoke(app, ["install-sudoers", "--interface", "Wi-Fi"])
    assert result.exit_code == 1
    assert "does not include the sudoers.d directory" in result.output
    assert calls == [["networksetup", "-listallnetworkservices"]]


def test_install_sudoers_permissionerror_and_sudo_denied_exits_cleanly(monkeypatch):
    monkeypatch.setattr("nextlevelapex.main2.sys.platform", "darwin")
    monkeypatch.setattr("getpass.getuser", lambda: "alice")

    def fake_run(cmd, **kwargs):
        if cmd == ["networksetup", "-listallnetworkservices"]:
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout="An asterisk (*) denotes that a network service is disabled.\nWi-Fi\n",
                stderr="",
            )
        if cmd == ["sudo", "-n", "cat", "/etc/sudoers"]:
            assert kwargs.get("timeout") == 5
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="sudo: permission denied")
        raise AssertionError(f"Unexpected subprocess call: {cmd}")

    monkeypatch.setattr("nextlevelapex.main2.subprocess.run", fake_run)
    monkeypatch.setattr(
        Path, "read_text", lambda self, *a, **k: (_ for _ in ()).throw(PermissionError())
    )

    result = runner.invoke(app, ["install-sudoers", "--interface", "Wi-Fi"])
    assert result.exit_code == 1
    assert "Could not verify /etc/sudoers includedir automatically" in result.output
    assert "run 'sudo visudo'" in result.output
    assert "Traceback" not in result.output


def test_install_sudoers_invalid_username_fails_closed(monkeypatch):
    monkeypatch.setattr("nextlevelapex.main2.sys.platform", "darwin")
    monkeypatch.setattr("getpass.getuser", lambda: "bad user")
    result = runner.invoke(app, ["install-sudoers", "--interface", "Wi-Fi"])
    assert result.exit_code == 1
    assert "Unsupported username for sudoers rule" in result.output
