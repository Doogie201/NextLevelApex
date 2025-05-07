# ~/Projects/NextLevelApex/nextlevelapex/tasks/system.py

import fnmatch
import logging
import shutil
import subprocess
from pathlib import Path
from tempfile import NamedTemporaryFile

from nextlevelapex.core.task import Severity, TaskResult

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


def ensure_aliases(config: dict, dry_run: bool = False) -> TaskResult:
    """Idempotently install your aliases inside a marked block."""
    result = TaskResult("system.aliases", success=True, changed=False, messages=[])
    sys_cfg = config.get("system", {})

    if not sys_cfg.get("add_aliases", False):
        result.messages.append((Severity.INFO, "Aliases disabled in config"))
        return result

    shellrc = Path(sys_cfg.get("shell_config_file", "~/.zshrc")).expanduser()
    lines = _read_shell_config(shellrc)

    # Build new_lines exactly like before…
    new_lines = []
    in_block = False
    for line in lines:
        if APEX_BLOCK_START_MARKER in line:
            in_block = True
            continue
        if APEX_BLOCK_END_MARKER in line:
            in_block = False
            continue
        if not in_block:
            new_lines.append(line)

    # Ensure trailing newline
    if new_lines and not new_lines[-1].endswith("\n"):
        new_lines[-1] += "\n"

    # Append fresh block
    new_lines.append(f"\n{APEX_BLOCK_START_MARKER}\n")
    for name, cmd in sys_cfg.get("aliases", {}).items():
        new_lines.append(f"alias {name}='{cmd}'\n")
    new_lines.append(f"{APEX_BLOCK_END_MARKER}\n")

    # Detect no-op
    if lines == new_lines:
        result.messages.append((Severity.INFO, "No alias changes needed"))
        return result

    result.changed = True
    if dry_run:
        result.messages.append((Severity.INFO, f"[dry-run] would rewrite {shellrc}"))
        return result

    # Atomic write via temp file
    with NamedTemporaryFile("w", dir=shellrc.parent, delete=False) as tmp:
        tmp.writelines(new_lines)
    shutil.move(tmp.name, shellrc)
    result.messages.append((Severity.INFO, f"Wrote aliases to {shellrc}"))
    return result


# --- TODO: Add function for prune_logitech_agents ---
def prune_logitech_agents(cfg: dict, dry_run: bool = False) -> TaskResult:
    result = TaskResult("system.prune_logitech", True, False, [])
    if not cfg.get("prune_logitech_agents", False):
        result.messages.append((Severity.INFO, "Logitech pruning disabled"))
        return result

    paths = []
    for p in Path("/Library/LaunchAgents").iterdir():
        if fnmatch.fnmatch(p.name, "com.logi.*"):
            paths.append(p)

    if not paths:
        result.messages.append((Severity.INFO, "No Logitech agents found"))
        return result

    for agent in paths:
        cmd_boot = ["sudo", "launchctl", "bootout", "system", str(agent)]
        cmd_rm = ["sudo", "rm", "-f", str(agent)]
        for cmd in (cmd_boot, cmd_rm):
            if dry_run:
                result.messages.append((Severity.INFO, f"[dry-run] {' '.join(cmd)}"))
            else:
                try:
                    subprocess.run(cmd, check=True, text=True, capture_output=True)
                    result.messages.append((Severity.INFO, f"Ran: {' '.join(cmd)}"))
                except subprocess.CalledProcessError as e:
                    result.success = False
                    result.messages.append(
                        (Severity.ERROR, f"Failed {cmd}: {e.stderr}")
                    )
    result.changed = True
    return result
