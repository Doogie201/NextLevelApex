#!/usr/bin/env python3
# ~/Projects/NextLevelApex/nextlevelapex/main.py
# (Showing relevant parts to add/modify)

import sys

# ... other imports ...
import logging
from pathlib import Path
from typing_extensions import Annotated

import typer

# Import task modules
from nextlevelapex.tasks import brew as brew_tasks
# from nextlevelapex.tasks import mise as mise_tasks # etc.

# Import core modules if needed directly here
# from nextlevelapex.core import state as state_manager # Assuming you build this


# --- Basic Logging Setup ---
# (Keep this near the top)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)-8s] %(message)s",  # Slightly improved format
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)  # Use this for logging within main

# --- Configuration & State Placeholders ---
# (Keep these for now, replace with real loading later)
DEFAULT_CONFIG_PATH = Path.home() / ".config" / "nextlevelapex" / "config.json"
DEFAULT_STATE_PATH = Path.home() / ".local" / "state" / "nextlevelapex" / "state.json"
DEFAULT_CONFIG = {  # Example subset
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
    # ... rest of config ...
}
STATE = {"completed_sections": []}

# --- Main CLI App ---
app = typer.Typer(help="Apex Level macOS Setup Orchestrator")


@app.command()
def run(
    # ... keep existing parameters: config_file, dry_run, verbose, resume, force_section ...
    config_file: Annotated[
        Path, typer.Option(help="Path to JSON configuration file.")
    ] = DEFAULT_CONFIG_PATH,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", "-n", help="Print commands without executing.")
    ] = False,
    verbose: Annotated[
        bool, typer.Option("--verbose", "-v", help="Enable verbose output.")
    ] = False,
    resume: Annotated[
        bool,
        typer.Option(help="Attempt to resume from last failed step (Not Implemented)."),
    ] = False,
    force_section: Annotated[
        str,
        typer.Option(
            help="Force specific section(s) to run, comma-separated (Not Implemented)."
        ),
    ] = "",
):
    """
    Run the Apex Level setup process.
    """
    if verbose:
        # Update root logger level if verbose flag is set
        logging.getLogger().setLevel(logging.DEBUG)
        log.debug("Verbose logging enabled.")

    log.info("Starting Apex Level Setup...")
    if dry_run:
        log.info(">>> DRY RUN MODE ENABLED <<<")

    # --- TODO: Implement proper Config & State Loading ---
    config = DEFAULT_CONFIG  # Use placeholder for now
    # state = STATE  # Use placeholder for now
    log.info(f"Using configuration (placeholder source): {config_file}")
    # log.debug(f"Loaded config: {config}") # Requires proper loading first
    # log.debug(f"Loaded state: {state}") # Requires proper loading first

    # --- Orchestration ---
    all_ok = True
    current_section = "Initialization"  # For error context

    try:
        # Section: Homebrew
        current_section = "Homebrew"
        if config.get("install_brew", True):  # Default to true if key missing
            log.info(f"--- Running Section: {current_section} ---")
            if not brew_tasks.is_brew_installed():
                if not brew_tasks.install_brew(dry_run=dry_run):
                    raise Exception(
                        "Failed to install Homebrew."
                    )  # Raise exception on critical failure
            else:
                log.info("Homebrew already installed.")

            if not brew_tasks.ensure_brew_shellenv(dry_run=dry_run):
                raise Exception("Failed to configure Homebrew shellenv.")

            if config.get("update_brew_on_run", True):
                if not brew_tasks.update_brew(dry_run=dry_run):
                    # Non-fatal, just log warning from function
                    pass

            if not brew_tasks.install_formulae(
                config.get("brew_formulae", []), dry_run=dry_run
            ):
                raise Exception("Failed during Homebrew formulae installation.")

            if not brew_tasks.install_casks(
                config.get("brew_casks", []), dry_run=dry_run
            ):
                raise Exception("Failed during Homebrew cask installation.")

            # TODO: Update state - state_manager.mark_complete(current_section)
            log.info(f"--- Section {current_section} Completed ---")
        else:
            log.info(f"--- Skipping Section: {current_section} (per config) ---")
            # TODO: Update state - state_manager.mark_skipped(current_section)

        # Section: Mise (Example)
        # current_section = "Mise"
        # log.info(f"--- Running Section: {current_section} ---")
        # # ... Call mise_tasks functions, check results, raise exceptions ...
        # log.info(f"--- Section {current_section} Completed ---")

        # ... Add calls for other task modules ...

    except Exception as e:
        log.error(f"--- Section '{current_section}' FAILED ---")
        log.error(f"Error: {e}", exc_info=verbose)  # Show traceback if verbose
        # TODO: Implement diagnostics call here
        # run_diagnostics(current_section, context...)
        all_ok = False

    # --- Final Summary ---
    if all_ok:
        log.info("=== Apex Level Setup Completed Successfully ===")
        # TODO: Print final status dashboard
    else:
        log.error("=== Apex Level Setup FAILED ===")
        sys.exit(1)  # Exit with non-zero code on failure


if __name__ == "__main__":
    app()
