# ~/Projects/NextLevelApex/nextlevelapex/core/config.py

import json
import logging
from pathlib import Path
from typing import Dict, Any

log = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "nextlevelapex" / "config.json"

# Define a basic default structure in case the file is missing
# In a more robust version, this might be loaded from templates/default_config.json
DEFAULT_CONFIG_DATA = {
    "install_brew": True,
    "update_brew_on_run": True,
    "brew_formulae": [
        "mise",
        "docker",
        "colima",
        "jq",
        "ollama",
        "eza",
        "bat",
        "fd",
        "ripgrep",
        "zoxide",
        "git-delta",
        "zellij",
        "fzf",
    ],
    "brew_casks": ["warp", "raycast", "font-meslo-lg-nerd-font"],
    "mise_global_tools": {  # Tools managed by mise globally
        "python": "3.11.9",  # Match .tool-versions used for dev env
        "poetry": "1.8.2",  # Match .tool-versions
        "node": "lts",
        "rust": "stable",
        "go": "1.22",  # Example, adjust as needed
    },
    "configure_shell_activation": True,  # For Mise/other tools if needed
    "shell_config_file": "~/.zshrc",  # File to add activation lines to
    "add_aliases": True,
    "aliases": {
        "lpm-on": "sudo powermetrics -q --lowpowermode on",
        "lpm-off": "sudo powermetrics -q --lowpowermode off",
    },
    "setup_security": True,
    # ... add placeholders for other sections: networking, ollama, etc.
}


def load_config(config_path: Path = DEFAULT_CONFIG_PATH) -> Dict[str, Any]:
    """Loads configuration from the specified JSON file."""
    log.info(f"Attempting to load configuration from: {config_path}")
    try:
        if not config_path.is_file():
            log.warning(f"Configuration file not found at {config_path}.")
            log.warning("Using default configuration values.")
            # Optional: Offer to generate default config file here
            # generate_default_config(config_path)
            return DEFAULT_CONFIG_DATA

        with open(config_path, "r") as f:
            user_config = json.load(f)
        log.info("Successfully loaded user configuration.")
        # TODO: Add validation using jsonschema?
        # Merge user config with defaults? Or just use user config?
        # For now, just return user config, assuming it's complete.
        # A better approach would merge, giving priority to user values.
        # merged_config = {**DEFAULT_CONFIG_DATA, **user_config} # Python 3.5+ merge
        return user_config

    except json.JSONDecodeError as e:
        log.error(f"Error decoding JSON from {config_path}: {e}")
        log.warning("Using default configuration values due to parse error.")
        return DEFAULT_CONFIG_DATA
    except Exception as e:
        log.error(
            f"Failed to load configuration from {config_path}: {e}", exc_info=True
        )
        log.warning("Using default configuration values due to unexpected error.")
        return DEFAULT_CONFIG_DATA


def generate_default_config(config_path: Path = DEFAULT_CONFIG_PATH) -> bool:
    """Generates a default config file if one doesn't exist."""
    if config_path.is_file():
        log.info(f"Config file already exists at {config_path}. Skipping generation.")
        return True
    log.info(f"Generating default configuration file at {config_path}...")
    try:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w") as f:
            json.dump(DEFAULT_CONFIG_DATA, f, indent=4)
        log.info("Default configuration file created successfully.")
        return True
    except Exception as e:
        log.error(f"Failed to generate default configuration file: {e}", exc_info=True)
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
