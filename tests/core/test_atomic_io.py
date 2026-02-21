import os
from unittest.mock import patch

import pytest

from nextlevelapex.core.io import atomic_write_text


def test_atomic_write_success(tmp_path):
    target = tmp_path / "target.txt"
    # Execute
    atomic_write_text(target, "hello world", perms=0o600)

    # Validate
    assert target.exists()
    assert target.read_text() == "hello world"
    # Check permissions (on posix)
    if os.name == "posix":
        assert (target.stat().st_mode & 0o777) == 0o600


def test_atomic_write_interruption(tmp_path):
    target = tmp_path / "target.txt"

    # Mock os.replace to simulate a crash mid-flight right before replace
    with (
        patch("nextlevelapex.core.io.Path.replace", side_effect=Exception("Simulated crash!")),
        pytest.raises(Exception, match="Simulated crash!"),
    ):
        atomic_write_text(target, "half written data")

    # File should not exist because it crashed before atomic swap
    assert not target.exists()

    # Ensure no temp file drops are left around
    temp_files = list(tmp_path.glob("*"))
    assert len(temp_files) == 0


def test_atomic_write_does_not_corrupt_existing(tmp_path):
    target = tmp_path / "target.txt"
    target.write_text("precious stable data")

    with (
        patch("nextlevelapex.core.io.Path.replace", side_effect=Exception("Simulated crash!")),
        pytest.raises(Exception, match="Simulated crash!"),
    ):
        atomic_write_text(target, "new corrupted data")

    # The original file must remain untouched
    assert target.exists()
    assert target.read_text() == "precious stable data"
