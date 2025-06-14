# ~/Projects/NextLevelApex/nextlevelapex/tasks/brew.py

import logging
import os
from pathlib import Path

# Import the command runner from the core module
from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskResult
from nextlevelapex.main import get_task_registry

log = LoggerProxy(__name__)

# --- Constants ---
HOMEBREW_INSTALL_URL = (
    "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"
)
HOMEBREW_PREFIX = "/opt/homebrew"  # Standard for Apple Silicon


def is_brew_installed() -> bool:
    """Checks if the Homebrew executable exists in the expected path."""
    brew_path = Path(HOMEBREW_PREFIX) / "bin" / "brew"
    # Use shutil.which for basic check, or run command for more robust check
    # return shutil.which("brew") is not None
    log.debug(f"Checking for brew at: {brew_path}")
    return brew_path.is_file()


def install_brew(dry_run: bool = False) -> bool:
    """Installs Homebrew using the official script."""
    if is_brew_installed():
        log.info("Homebrew already installed.")
        return True

    log.info("Homebrew not found. Attempting installation...")
    # The official script needs to be run non-interactively
    # We pipe /dev/null to handle potential prompts, though the script *should* be non-interactive
    # Running via bash -c "..."
    cmd = [
        "/bin/bash",
        "-c",
        f'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL {HOMEBREW_INSTALL_URL})" < /dev/null',
    ]
    result = run_command(
        cmd, dry_run=dry_run, check=True
    )  # Check ensures failure stops us

    if result.success and not dry_run:
        # Verify install after running (necessary if check=False above)
        if is_brew_installed():
            log.info("Homebrew installation successful.")
            return True
        else:
            log.error(
                "Homebrew installation command ran but 'brew' not found afterwards."
            )
            return False
    elif dry_run and result.success:
        log.info("DRYRUN: Homebrew installation would be attempted.")
        return True  # Assume success for dry run
    else:
        log.error("Homebrew installation failed.")
        return False


def ensure_brew_shellenv(dry_run: bool = False) -> bool:
    """Ensures brew shellenv is evaluated and added to ~/.zprofile."""
    log.info("Configuring Homebrew shell environment...")
    brew_path = Path(HOMEBREW_PREFIX) / "bin" / "brew"
    if not brew_path.is_file():
        log.error("Cannot configure shellenv: brew executable not found.")
        return False

    # 1. Evaluate for current process environment
    log.debug("Evaluating brew shellenv for current Python process...")
    result = run_command([str(brew_path), "shellenv"], dry_run=dry_run, check=True)
    if not result.success:
        log.error("Failed to execute 'brew shellenv'. Cannot update environment.")
        return False

    if result.stdout and not dry_run:
        # Parse output like: export VAR="value"; export VAR2="value2";
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("export "):
                parts = line.replace("export ", "").split("=", 1)
                if len(parts) == 2:
                    key = parts[0]
                    # Remove potential quotes around value
                    value = parts[1].strip("'\"")
                    log.debug(f"Setting env var: {key}={value}")
                    os.environ[key] = value
                else:
                    log.warning(f"Could not parse brew shellenv line: {line}")
        log.info("Current process environment updated with Homebrew paths.")

    # 2. Add to ~/.zprofile if not present
    profile_path = Path.home() / ".zprofile"
    shellenv_command = f'eval "$({brew_path} shellenv)"'
    line_found = False
    if profile_path.is_file():
        try:
            with open(profile_path, "r") as f:
                for line in f:
                    if shellenv_command in line:
                        line_found = True
                        break
        except Exception as e:
            log.error(f"Error reading {profile_path}: {e}")
            # Continue to attempt writing, maybe file had issues

    if line_found:
        log.info(f"Homebrew shellenv command already found in {profile_path}.")
    else:
        log.info(f"Adding Homebrew shellenv command to {profile_path}...")
        if not dry_run:
            try:
                with open(profile_path, "a") as f:
                    f.write("\n# Homebrew environment\n")
                    f.write(f"{shellenv_command}\n")
                log.info(f"Successfully added shellenv command to {profile_path}.")
            except Exception as e:
                log.error(f"Failed to write to {profile_path}: {e}")
                return False  # Fail if we couldn't write to profile
        else:
            log.info(f"DRYRUN: Would add shellenv command to {profile_path}.")

    return True


@task("Homebrew Install")
def install_brew_task(ctx) -> TaskResult:
    success = install_brew(dry_run=ctx["dry_run"])
    messages = []
    if not success:
        messages.append((Severity.ERROR, "Homebrew install failed"))
    return TaskResult(
        name="Homebrew Install",
        success=success,
        changed=success and not ctx["dry_run"],
        messages=messages,
    )


@task("Homebrew Shellenv")
def ensure_brew_shellenv_task(ctx) -> TaskResult:
    success = ensure_brew_shellenv(dry_run=ctx["dry_run"])
    messages = []
    if not success:
        messages.append((Severity.ERROR, "Failed to configure brew shellenv"))
    return TaskResult(
        name="Homebrew Shellenv",
        success=success,
        changed=success and not ctx["dry_run"],
        messages=messages,
    )


def update_brew(dry_run: bool = False) -> bool:
    """Runs 'brew update'."""
    log.info("Running 'brew update'...")
    result = run_command(
        ["brew", "update"], dry_run=dry_run, check=False
    )  # Don't fail script if update has minor issues
    if not result.success and not dry_run:
        log.warning("'brew update' finished with errors, but continuing.")
        return True  # Treat as non-fatal for now
    log.info("'brew update' completed.")
    return True


log = LoggerProxy(__name__)


def install_formulae(formula_list: list[str], dry_run: bool = False) -> bool:
    log.debug(
        f"install_formulae received list: {formula_list} (Type: {type(formula_list)})"
    )
    if not formula_list:
        log.info("No Homebrew formulae specified for installation.")
        return True
    log.info(f"Installing Homebrew formulae: {', '.join(formula_list)}...")
    # Install all at once for potentially better dependency resolution
    cmd = ["brew", "install"] + formula_list
    result = run_command(cmd, dry_run=dry_run, check=True)
    if not result.success:
        log.error(f"Failed to install one or more formulae: {formula_list}")
        return False
    log.info("Formulae installation command finished.")
    return True


log = LoggerProxy(__name__)


def install_casks(cask_list: list[str], dry_run: bool = False) -> bool:
    log.debug(
        f"install_casks received list: {cask_list} (Type: {type(cask_list)})"
    )
    if not cask_list:
        log.info("No Homebrew casks specified for installation.")
        return True
    log.info(f"Installing Homebrew casks: {', '.join(cask_list)}...")
    cmd = ["brew", "install", "--cask"] + cask_list
    result = run_command(cmd, dry_run=dry_run, check=True)
    if not result.success:
        log.error(f"Failed to install one or more casks: {cask_list}")
        return False
    log.info("Cask installation command finished.")
    return True
