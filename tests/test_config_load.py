import json
from pathlib import Path

from nextlevelapex.core.config import load_config


def test_load_generated_config(tmp_path: Path):
    config_path = tmp_path / "config.json"
    config_data = {
        "script_behavior": {},
        "system": {},
        "security": {},
        "homebrew": {"formulae": [], "casks": []},
        "developer_tools": {},
        "networking": {},
        "local_ai": {},
        "automation_agents": {},
        "optional_apps": {},
    }
    config_path.write_text(json.dumps(config_data))
    result = load_config(config_path)
    assert isinstance(result, dict)
    assert "system" in result
