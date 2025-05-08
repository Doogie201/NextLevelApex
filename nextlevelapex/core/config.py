# ~/Projects/NextLevelApex/nextlevelapex/core/config.py

import json
import logging
from importlib import resources
from pathlib import Path
from typing import Any, Dict

import jsonschema
from jsonschema import Draft7Validator

# Load our JSON Schema as a Python dict
with resources.open_text("nextlevelapex.schema", "config.v1.schema.json") as f:
    SCHEMA = json.load(f)

log = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "nextlevelapex" / "config.json"

# Define a basic default structure in case the file is missing
# In a more robust version, this might be loaded from templates/default_config.json
# DEFAULT_CONFIG_DATA = {
#     "install_brew": True,
#     "update_brew_on_run": True,
#     "brew_formulae": [
#         "mise",
#         "docker",
#         "colima",
#         "jq",
#         "ollama",
#         "eza",
#         "bat",
#         "fd",
#         "ripgrep",
#         "zoxide",
#         "git-delta",
#         "zellij",
#         "fzf",
#     ],
#     "brew_casks": ["warp", "raycast", "font-meslo-lg-nerd-font"],
#     "mise_global_tools": {  # Tools managed by mise globally
#         "python": "3.11.9",  # Match .tool-versions used for dev env
#         "poetry": "1.8.2",  # Match .tool-versions
#         "node": "lts",
#         "rust": "stable",
#         "go": "1.22",  # Example, adjust as needed
#     },
#     "configure_shell_activation": True,  # For Mise/other tools if needed
#     "shell_config_file": "~/.zshrc",  # File to add activation lines to
#     "add_aliases": True,
#     "aliases": {
#         "lpm-on": "sudo powermetrics -q --lowpowermode on",
#         "lpm-off": "sudo powermetrics -q --lowpowermode off",
#     },
#     "setup_security": True,
#     # ... add placeholders for other sections: networking, ollama, etc.
# }

# grab the un-hooked "properties" validator
_default_properties = Draft7Validator.VALIDATORS["properties"]


def _set_defaults(validator, properties, instance, schema):
    """
    jsonschema hook: whenever a property has a 'default', insert it,
    then delegate to the original Draft7 `properties` validator.
    """
    # only apply to dicts
    if not isinstance(instance, dict):
        return
    # inject any defaults
    for prop, subschema in properties.items():
        if "default" in subschema:
            instance.setdefault(prop, subschema["default"])

    for error in _default_properties(validator, properties, instance, schema):
        yield error


def _deep_update(base: dict, updates: dict):
    """
    Recursively update base with updates (mutates base).
    """
    for k, v in updates.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_update(base[k], v)
        else:
            base[k] = v


def load_config(config_path: Path = DEFAULT_CONFIG_PATH) -> Dict[str, Any]:
    """
    Loads and validates configuration against our JSON Schema.
    Fills in any missing properties with the schema’s own default values.
    """
    log.info(f"Attempting to load configuration from: {config_path}")

    # 1) Start with an empty dict
    config: Dict[str, Any] = {}

    # 2) Build two validators:
    #    - inject_validator: uses _set_defaults to populate defaults
    #    - final_validator: pure Draft7Validator for actual validation
    validator_cls = jsonschema.validators.extend(
        jsonschema.Draft7Validator,
        {"properties": _set_defaults},
    )
    inject_validator = validator_cls(SCHEMA)
    final_validator = jsonschema.Draft7Validator(SCHEMA)

    # 3) Run through inject_validator to fill in schema defaults (no errors raised)
    for _ in inject_validator.iter_errors(config):
        pass

    # 4) Overlay user file if it exists
    if config_path.is_file():
        try:
            user_config = json.loads(config_path.read_text())
            # Validate the user’s partial config (and pick up any new defaults)
            final_validator.validate(user_config)
        except json.JSONDecodeError as e:
            log.error(f"Error parsing JSON: {e}")
            log.warning("Using schema defaults only.")
            return config
        except jsonschema.ValidationError as e:
            log.error(f"Configuration validation error: {e.message}")
            log.warning("Falling back to schema defaults.")
            return config

        # Merge user values onto our defaults
        _deep_update(config, user_config)

        # Now validate the merged config
        try:
            final_validator.validate(config)
        except jsonschema.ValidationError as e:
            log.error(f"Merged configuration failed schema validation: {e.message}")
            raise

        log.info("Configuration loaded and validated.")
        return config

    # 5) No user file: return just schema defaults
    log.warning(f"No config at {config_path}; using schema defaults.")
    return config


def generate_default_config(config_path: Path = DEFAULT_CONFIG_PATH) -> bool:
    if config_path.is_file():
        log.info("Config already exists; skipping.")
        return True

    config_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        # Ensure load_config logic has built-in defaults
        defaults = load_config(config_path)  # with no file → schema defaults
        config_path.write_text(json.dumps(defaults, indent=4))
        log.info("Default configuration file created.")
        return True
    except Exception as e:
        log.error(f"Failed to write default config: {e}")
        return False


# Example of how to add a command to generate config in main.py:
# @app.command()
# def generate_config(
#    force: Annotated[bool, typer.Option("--force", help="Overwrite existing config file.")] = False,
# ):
#    """Generates a default config file at ~/.config/nextlevelapex/config.json"""
#    config_path = DEFAULT_CONFIG_PATH
#    if force and config_path.is_file():
#        log.warning(f"Overwriting existing config file at {config_path}")
#        config_path.unlink()
#    if config_loader.generate_default_config(config_path):
#       typer.echo(f"Default config generated at {config_path}")
#    else:
#       typer.echo(f"Failed to generate config file.", err=True)
