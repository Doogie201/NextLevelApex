# ~/Projects/NextLevelApex/nextlevelapex/core/command.py

import shlex
import subprocess

from nextlevelapex.core.logger import LoggerProxy

# Get logger instance (assuming basic config in main.py for now)
log = LoggerProxy(__name__)


class CommandResult:
    """Holds the result of a command execution."""

    def __init__(self, returncode: int, stdout: str, stderr: str, success: bool):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.success = success  # True if returncode is 0 (or if check=False)

    def __bool__(self) -> bool:
        """Allows treating the result object as boolean for success."""
        return self.success


def run_command(
    cmd_list: list[str],
    dry_run: bool = False,
    check: bool = True,  # If True, non-zero exit code is considered failure
    capture: bool = True,  # Capture stdout/stderr
    text: bool = True,  # Decode output as text
    cwd: str | None = None,  # Working directory
    env: dict[str, str] | None = None,  # Environment variables
) -> CommandResult:
    """
    Runs an external command using subprocess.

    Args:
        cmd_list: Command and arguments as a list of strings.
        dry_run: If True, print the command instead of running it.
        check: If True, non-zero exit codes indicate failure.
        capture: If True, capture stdout and stderr.
        text: If True, decode stdout/stderr as text.
        cwd: Directory to run the command in.
        env: Environment variables dictionary for the subprocess.

    Returns:
        CommandResult object with success status, return code, stdout, stderr.
    """
    cmd_str = shlex.join(cmd_list)  # Safely join args for logging
    log.info(f"Running: {cmd_str}" + (f" in {cwd}" if cwd else ""))

    if dry_run:
        print(f"DRYRUN: Would execute: {cmd_str}")
        # For dry run, assume success unless we add more complex checks later
        return CommandResult(returncode=0, stdout="", stderr="", success=True)

    try:
        process = subprocess.run(
            cmd_list,
            check=False,  # We check manually based on the 'check' flag
            capture_output=capture,
            text=text,
            cwd=cwd,
            env=env,
        )

        stdout = process.stdout.strip() if process.stdout else ""
        stderr = process.stderr.strip() if process.stderr else ""

        if stdout:
            log.debug(f"STDOUT: {stdout}")
        if stderr:
            # Log stderr as warning if return code is 0, error otherwise
            if process.returncode == 0:
                log.warning(f"STDERR (RC=0): {stderr}")
            else:
                log.error(f"STDERR (RC={process.returncode}): {stderr}")

        success = process.returncode == 0

        if check and not success:
            log.error(f"Command failed with exit code {process.returncode}: {cmd_str}")
            return CommandResult(process.returncode, stdout, stderr, success=False)
        else:
            # If check is False, or if check is True and RC is 0
            log.debug(f"Command finished with exit code {process.returncode}.")
            return CommandResult(process.returncode, stdout, stderr, success=success)

    except FileNotFoundError:
        log.error(f"Command not found: {cmd_list[0]}")
        return CommandResult(
            returncode=-1,
            stdout="",
            stderr=f"Command not found: {cmd_list[0]}",
            success=False,
        )
    except Exception as e:
        log.error(f"An unexpected error occurred running command: {cmd_str}", exc_info=True)
        return CommandResult(returncode=-1, stdout="", stderr=str(e), success=False)
