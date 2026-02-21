import os
import stat
from pathlib import Path
from unittest.mock import patch

import pytest

from nextlevelapex.core.io import atomic_write_text
from nextlevelapex.core.state import save_state


def test_atomic_write_calls_os_replace(tmp_path: Path):
    target = tmp_path / "target.txt"
    with patch("nextlevelapex.core.io.os.replace", wraps=os.replace) as mock_replace:
        atomic_write_text(target, "hello world")
    assert target.read_text() == "hello world"
    assert mock_replace.called
    assert Path(mock_replace.call_args.args[1]) == target


def test_atomic_write_failure_does_not_create_partial_destination(tmp_path: Path):
    target = tmp_path / "target.txt"
    with (
        patch("nextlevelapex.core.io.os.fdopen", side_effect=OSError("write failed")),
        pytest.raises(OSError, match="write failed"),
    ):
        atomic_write_text(target, "half written data")

    assert not target.exists()
    assert list(tmp_path.iterdir()) == []


def test_atomic_write_failure_does_not_corrupt_existing_file(tmp_path: Path):
    target = tmp_path / "target.txt"
    target.write_text("stable data")

    with (
        patch("nextlevelapex.core.io.os.fdopen", side_effect=OSError("write failed")),
        pytest.raises(OSError, match="write failed"),
    ):
        atomic_write_text(target, "new data")

    assert target.exists()
    assert target.read_text() == "stable data"


@pytest.mark.skipif(os.name == "nt", reason="POSIX-only permission semantics")
def test_save_state_enforces_0600_permissions(tmp_path: Path):
    path = tmp_path / "state.json"
    assert save_state({"key": "value"}, path, dry_run=False) is True
    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o600
