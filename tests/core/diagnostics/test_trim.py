import pytest

from nextlevelapex.core.diagnostics import trim_large_fields
from nextlevelapex.core.smartconfig import global_config


@pytest.fixture(autouse=True)
def enable_bloat_protection():
    # Enable for all tests
    global_config.enable_bloat_protection = True
    global_config.max_string_len = 50
    global_config.max_list_items = 3
    global_config.max_log_lines = 4
    yield
    # Reset after tests if needed
    global_config.enable_bloat_protection = True


def test_trim_long_string():
    data = {"log": "x" * 100}
    result, _ = trim_large_fields(data)
    assert result["log"].startswith("x" * 50)
    assert "trimmed" in result["log"]


def test_trim_long_list():
    data = {"items": [1, 2, 3, 4, 5, 6]}
    result, _ = trim_large_fields(data)
    assert result["items"] == [1, 2, 3, "... (list trimmed)"]


def test_trim_multiline_string():
    # Force line trimming logic only
    original_max_string_len = global_config.max_string_len
    original_max_log_lines = global_config.max_log_lines

    global_config.max_string_len = 1000  # High enough not to trim string length
    global_config.max_log_lines = 4  # Will trigger line count trimming

    try:
        data = {"logs": "\n".join([f"Line {i}" for i in range(10)])}
        result, _ = trim_large_fields(data)
        trimmed_output = result["logs"]

        assert trimmed_output.count("\n") == 4
        assert trimmed_output.endswith("... (trimmed @ 4 lines)")
    finally:
        global_config.max_string_len = original_max_string_len
        global_config.max_log_lines = original_max_log_lines


def test_nested_structure():
    data = {
        "outer": {
            "inner": {
                "log": "A" * 100,
                "lines": "\n".join(["X"] * 10),
                "list": list(range(10)),
            }
        }
    }
    result, _ = trim_large_fields(data)
    inner = result["outer"]["inner"]
    assert "trimmed" in inner["log"]
    assert inner["lines"].count("\n") == 4
    assert inner["list"][-1] == "... (list trimmed)"


def test_untouched_fields():
    data = {"short": "OK", "list": [1, 2], "multiline": "Line\nTwo"}
    result, _ = trim_large_fields(data)
    assert result == data
