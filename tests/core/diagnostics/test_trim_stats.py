import pytest

from nextlevelapex.core.smartconfig import global_config
from nextlevelapex.utils.sanitizer import trim_large_fields


@pytest.fixture(autouse=True)
def enable_bloat_protection():
    global_config.enable_bloat_protection = True
    global_config.max_string_len = 50
    global_config.max_log_lines = 2
    global_config.max_list_items = 3
    yield


def test_trim_stats_are_correct():
    data = {
        "long_str": "x" * 100,  # trimmed, 50 removed
        "long_list": list(range(10)),  # trimmed
        "logs": "\n".join(
            [f"Line {i}" for i in range(10)]
        ),  # multiline trimmed, 8 lines removed
        "nested": {"deep_str": "y" * 75},  # trimmed, 25 removed
    }

    trimmed, stats = trim_large_fields(data)

    assert stats["fields_trimmed"] == 4
    assert stats["string_fields_trimmed"] == 3  # long_str, logs, deep_str
    assert stats["lists_trimmed"] == 1
    assert stats["chars_removed"] == 75  # 50 from long_str + 25 from deep_str
    assert stats["lines_removed"] == 8  # from logs
    assert stats["total_nested_paths_touched"] == 5
