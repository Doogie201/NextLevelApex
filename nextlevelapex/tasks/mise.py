# ~/Projects/NextLevelApex/nextlevelapex/tasks/mise.py

import logging
from pathlib import Path
from typing import Dict

from nextlevelapex.core.command import run_command

log = logging.getLogger(__name__)


def setup_mise_globals(tools: Dict[str, str], dry_run: bool = False) -> bool:
    """
    Installs or updates global tools using 'mise use -g'.

    Args:
        tools: Dictionary where keys are tool names and values are versions.
               Example: {"python": "3.11.9", "node": "lts"}
        dry_run: If True, only print the command.

    Returns:
        True if successful or dry run, False otherwise.
    """
    log.debug(f"setup_mise_globals received dict: {tools} (Type: {type(tools)})")
    if not tools:
        log.info("No Mise global tools specified in config.")
        return True

    tool_args = [f"{name}@{version}" for name, version in tools.items()]
    log.info(f"Setting global Mise tools: {', '.join(tool_args)}...")

    cmd = ["mise", "use", "--global"] + tool_args
    result = run_command(cmd, dry_run=dry_run, check=True)  # Fail if mise use fails

    if not result.success:
        log.error("Failed to set global Mise tools.")
        return False

    # After setting, run install to ensure they are actually downloaded/built
    cmd_install = ["mise", "install"]
    log.info("Ensuring Mise global tools are installed...")
    result_install = run_command(cmd_install, dry_run=dry_run, check=True)

    if not result_install.success:
        log.error("Failed to install global Mise tools after setting versions.")
        return False

    log.info("Mise global tools setup finished.")
    return True


def ensure_mise_activation(
    shell_config_file: str = "~/.zshrc",  # Get from config
    dry_run: bool = False,
) -> bool:
    """Ensures 'mise activate zsh' line is present in the shell config file."""
    activation_line = 'eval "$(mise activate zsh)"'  # Command to activate mise
    # Expand ~ and resolve path
    config_path = Path(shell_config_file).expanduser().resolve()

    log.info(f"Ensuring Mise activation command is in {config_path}...")

    if not config_path.parent.exists():
        log.warning(
            f"Parent directory for {config_path} does not exist. Cannot check/add activation line."
        )
        # This usually shouldn't happen for ~/.zshrc
        return True  # Don't fail, just warn and continue

    line_found = False
    if config_path.is_file():
        try:
            with open(config_path, "r") as f:
                for line in f:
                    # Check for the exact line or common variations
                    if activation_line in line and not line.strip().startswith("#"):
                        line_found = True
                        break
        except Exception as e:
            log.error(f"Error reading {config_path}: {e}")
            # Proceed to attempt writing

    if line_found:
        log.info(f"Mise activation line already found in {config_path}.")
        return True
    else:
        log.info(f"Mise activation line not found. Adding to {config_path}...")
        if not dry_run:
            try:
                with open(config_path, "a") as f:
                    f.write("\n# Mise shell activation\n")
                    f.write(f"{activation_line}\n")
                log.info(f"Successfully added Mise activation line to {config_path}.")
                return True
            except Exception as e:
                log.error(f"Failed to write Mise activation line to {config_path}: {e}")
                return False  # Fail if we can't write it
        else:
            log.info(f"DRYRUN: Would add Mise activation line to {config_path}.")
            return True
