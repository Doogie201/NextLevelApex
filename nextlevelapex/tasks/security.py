# ~/Projects/NextLevelApex/nextlevelapex/tasks/security.py

import logging
import shlex
import subprocess
from pathlib import Path
from typing import Dict

from nextlevelapex.core.command import run_command

log = logging.getLogger(__name__)

# --- Constants ---
FIREWALL_UTIL = "/usr/libexec/ApplicationFirewall/socketfilterfw"
PAM_SUDO_FILE = Path("/etc/pam.d/sudo")
PAM_TID_LINE = "auth       sufficient     pam_tid.so"  # Touch ID auth


def set_firewall_stealth(config: Dict, dry_run: bool = False) -> bool:
    """Enables macOS firewall stealth mode."""
    security_config = config.get("security", {})
    if not security_config.get("enable_firewall_stealth", False):
        log.info("Skipping firewall stealth mode configuration as per config.")
        return True

    log.info("Enabling macOS firewall stealth mode...")
    # This command requires sudo
    cmd = ["sudo", FIREWALL_UTIL, "--setstealthmode", "on"]
    result = run_command(cmd, dry_run=dry_run, check=True)

    if not result.success and not dry_run:
        log.error("Failed to enable firewall stealth mode. Requires sudo privileges.")
        # Consider this non-fatal for now, maybe user cancelled sudo
        return True
    elif result.success:
        log.info("Firewall stealth mode enabled.")

    return True


def enable_touchid_sudo(config: Dict, dry_run: bool = False) -> bool:
    """Adds the pam_tid.so rule to the /etc/pam.d/sudo file for Touch ID sudo."""
    security_config = config.get("security", {})
    if not security_config.get("enable_touchid_sudo", False):
        log.info("Skipping Touch ID for sudo configuration as per config.")
        return True

    log.info(f"Ensuring Touch ID for sudo is configured in {PAM_SUDO_FILE}...")

    # Check if the line already exists (requires reading the file)
    line_found = False
    if PAM_SUDO_FILE.is_file():
        try:
            # Reading /etc/pam.d/sudo might require root, but often readable
            # We'll try without sudo first, then assume it needs adding if read fails or line not found
            with open(PAM_SUDO_FILE, "r") as f:
                for line in f:
                    # Check if line exists and is not commented out
                    if PAM_TID_LINE in line and not line.strip().startswith("#"):
                        line_found = True
                        log.info(f"Touch ID PAM rule already found in {PAM_SUDO_FILE}.")
                        break
        except PermissionError:
            log.warning(
                f"Permission denied reading {PAM_SUDO_FILE}. Assuming rule needs to be added."
            )
        except Exception as e:
            log.warning(
                f"Could not read {PAM_SUDO_FILE} to check for existing rule: {e}. Assuming rule needs to be added."
            )

    if line_found:
        return True  # Already configured

    # If line not found or couldn't check, attempt to add it using sudo tee
    log.info(f"Attempting to add Touch ID PAM rule to {PAM_SUDO_FILE}...")

    # Need to be careful with quoting for the shell command executed by sudo
    # Using 'printf' and piping to 'sudo tee -a' is safer than 'echo | sudo tee'
    # Ensure the line has a newline at the end for tee -a
    pam_line_with_newline = f"{PAM_TID_LINE}\\n"

    # We need to pipe the string to the sudo tee command's stdin
    # Subprocess doesn't handle this directly with check=True easily.
    # Let's construct a shell command string carefully.
    # NOTE: This is less ideal than using Python file I/O if we had root,
    # but necessary for using sudo tee non-interactively.
    shell_cmd_str = f"printf '%s' '{pam_line_with_newline}' | sudo tee -a {shlex.quote(str(PAM_SUDO_FILE))} > /dev/null"

    log.info(f"Running shell command: {shell_cmd_str}")

    if dry_run:
        print(f"DRYRUN: Would execute shell command: {shell_cmd_str}")
        return True

    try:
        # Use subprocess.run with shell=True for the pipe and sudo tee
        subprocess.run(
            shell_cmd_str,
            shell=True,
            check=True,  # Raise exception on failure
            capture_output=True,
            text=True,
        )
        log.info(f"Successfully added Touch ID PAM rule to {PAM_SUDO_FILE}.")
        return True
    except subprocess.CalledProcessError as e:
        log.error(
            f"Failed to add Touch ID PAM rule. Command failed with exit code {e.returncode}."
        )
        log.error(f"STDERR: {e.stderr.strip()}")
        # Consider non-fatal for now
        return True
    except Exception as e:
        log.error(
            f"An unexpected error occurred adding Touch ID PAM rule: {e}", exc_info=True
        )
        return True  # Non-fatal


# --- TODO: Add functions for YubiKey, KnockKnock/BlockBlock install ---
