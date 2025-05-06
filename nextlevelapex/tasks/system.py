# ~/Projects/NextLevelApex/nextlevelapex/tasks/system.py

import logging
from pathlib import Path
from typing import Dict

log = logging.getLogger(__name__)

# --- Constants ---
APEX_BLOCK_START_MARKER = "# --- NextLevelApex Aliases Start ---"
APEX_BLOCK_END_MARKER = "# --- NextLevelApex Aliases End ---"


def _read_shell_config(config_path: Path) -> list[str]:
    """Reads lines from the shell config file, returns empty list on error."""
    if not config_path.is_file():
        return []
    try:
        with open(config_path, "r") as f:
            return f.readlines()
    except Exception as e:
        log.error(f"Error reading shell config {config_path}: {e}")
        return []


def _write_shell_config(config_path: Path, lines: list[str], dry_run: bool) -> bool:
    """Writes lines to the shell config file."""
    log.info(f"Updating shell configuration file: {config_path}")
    if dry_run:
        log.info(f"DRYRUN: Would write {len(lines)} lines to {config_path}")
        # Simulate changes for logging
        print("\n--- DRYRUN: Proposed content for shell config ---")
        print("".join(lines).strip())
        print("--- End DRYRUN ---")
        return True
    try:
        # Ensure parent directory exists (should for ~/.zshrc, but good practice)
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w") as f:
            f.writelines(lines)
        log.info(f"Successfully updated {config_path}")
        return True
    except Exception as e:
        log.error(f"Failed to write shell config {config_path}: {e}")
        return False


def ensure_aliases(
    config: Dict,  # The loaded config dictionary
    dry_run: bool = False,
) -> bool:
    """
    Ensures aliases defined in the config are present in the shell config file.
    Manages aliases within a specific marked block to avoid duplicates on re-runs.
    """
    system_config = config.get("system", {})
    if not system_config.get("add_aliases", False):
        log.info("Skipping alias configuration as per config.")
        return True

    aliases_to_add = system_config.get("aliases", {})
    if not aliases_to_add:
        log.info("No aliases defined in configuration.")
        return True

    shell_config_file = system_config.get("shell_config_file", "~/.zshrc")
    config_path = Path(shell_config_file).expanduser().resolve()

    log.info(f"Ensuring aliases are configured in: {config_path}")

    current_lines = _read_shell_config(config_path)
    new_lines = []
    in_apex_block = False
    _apex_block_exists = True  # noqa: F841  # future use

    # Process existing lines, removing the old Apex block if found
    for line in current_lines:
        if APEX_BLOCK_START_MARKER in line:
            in_apex_block = True
            _apex_block_exists = True  # noqa: F841  # future use
            continue  # Skip start marker
        if APEX_BLOCK_END_MARKER in line:
            in_apex_block = False
            continue  # Skip end marker
        if not in_apex_block:
            new_lines.append(line)  # Keep lines outside the block

    # Ensure trailing newline if file wasn't empty
    if new_lines and not new_lines[-1].endswith("\n"):
        new_lines[-1] += "\n"

    # Add the new Apex block with current aliases
    log.debug(f"Adding/Updating Apex alias block with {len(aliases_to_add)} aliases.")
    new_lines.append(f"\n{APEX_BLOCK_START_MARKER}\n")
    for name, command in aliases_to_add.items():
        # Basic validation/escaping might be needed for complex commands
        alias_line = f"alias {name}='{command}'\n"
        new_lines.append(alias_line)
    new_lines.append(f"{APEX_BLOCK_END_MARKER}\n")

    return _write_shell_config(config_path, new_lines, dry_run)


# --- TODO: Add function for prune_logitech_agents ---
def prune_logitech_agents(config: Dict, dry_run: bool = False) -> bool:
    system_config = config.get("system", {})
    if not system_config.get("prune_logitech_agents", False):
        log.info("Skipping Logitech agent pruning as per config.")
        return True

    log.warning("Logitech agent pruning is not yet implemented in system.py")
    # Placeholder implementation:
    # 1. Find files matching /Library/LaunchAgents/com.logi.*
    # 2. For each file:
    #    - Run `sudo launchctl bootout system "<path>"` via CommandRunner (needs sudo handling)
    #    - Run `sudo rm -f "<path>"` via CommandRunner (needs sudo handling)
    # Need robust error handling and sudo capability in CommandRunner
    return True  # Return True for now
