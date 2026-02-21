import json
from pathlib import Path

from nextlevelapex.core.state import (
    atomic_write_json_0600,
    compute_file_history_hash,
    file_hash_changed,
)


def test_atomic_write_json_0600(tmp_path: Path):
    target = tmp_path / "state.json"
    data = {"test": 123}

    # Write and verify
    assert atomic_write_json_0600(data, target) is True
    assert target.exists()

    # Verify permissions are 0600 using Path.stat()
    stat = target.stat()
    assert oct(stat.st_mode)[-3:] == "600"

    # Verify contents
    with open(target) as f:
        loaded = json.load(f)
    assert loaded == data


def test_compute_hash_pure(tmp_path: Path):
    tracked = tmp_path / "config.json"
    tracked.write_text('{"setting": "old"}')

    # Compute hash without mutating any system state dict
    h1 = compute_file_history_hash(tracked)
    assert h1.startswith("sha256:")

    # Compute again, should match exactly
    h2 = compute_file_history_hash(tracked)
    assert h1 == h2


def test_drift_detection_integration(tmp_path: Path):
    tracked = tmp_path / "config.json"
    tracked.write_text("v1")

    # State tracking
    state = {"file_hashes": {}}
    h1 = compute_file_history_hash(tracked)
    state["file_hashes"][str(tracked)] = h1

    # Unchanged scenario
    assert file_hash_changed(state, tracked) is False

    # Drift scenario
    tracked.write_text("v2")
    assert file_hash_changed(state, tracked) is True
