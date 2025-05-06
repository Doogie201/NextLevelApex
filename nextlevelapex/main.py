#!/usr/bin/env python3
"""
NextLevelApex: Apex Level macOS Setup Orchestrator
Main entry point for the CLI application.
"""

# Standard Library Imports
import logging
import sys
from pathlib import Path

# Third-Party Imports
import typer
from typing_extensions import Annotated

# Local Application Imports
# Core modules first
from nextlevelapex.core import config as config_loader
# from nextlevelapex.core import state as state_manager # Placeholder

# Task modules
from nextlevelapex.tasks import brew as brew_tasks
from nextlevelapex.tasks import mise as mise_tasks
# ... import other task modules as they are created ...


# --- Basic Logging Setup ---
# Configure logging BEFORE getting the logger instance
logging.basicConfig(
    level=logging.INFO,  # Default level
    format="%(asctime)s [%(levelname)-8s] %(name)-15s: %(message)s",  # Include module name
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],  # Use stdout
)
# Get the root logger for use in this main module
log = logging.getLogger(__name__)

# --- Constants ---
DEFAULT_CONFIG_PATH = Path.home() / ".config" / "nextlevelapex" / "config.json"
DEFAULT_STATE_PATH = Path.home() / ".local" / "state" / "nextlevelapex" / "state.json"
# STATE placeholder - replace with actual loading later
STATE = {"completed_sections": []}


# --- Typer CLI App Definition ---
app = typer.Typer(
    help="NextLevelApex: Apex Level macOS Setup Orchestrator.",
    add_completion=False,  # Disable shell completion for now
)

# --- CLI Commands ---


@app.command()
def run(
    config_file: Annotated[
        Path,
        typer.Option(
            help="Path to JSON configuration file.",
            envvar="NLX_CONFIG_FILE",  # Allow overriding via env var
        ),
    ] = DEFAULT_CONFIG_PATH,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", "-n", help="Print commands without executing.")
    ] = False,
    verbose: Annotated[
        bool, typer.Option("--verbose", "-v", help="Enable verbose (DEBUG) output.")
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
    Run the main setup process defined by the configuration file.
    """
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)  # Set root logger to DEBUG
        log.debug("Verbose logging enabled.")

    log.info("Starting Apex Level Setup...")
    if dry_run:
        log.info(">>> DRY RUN MODE ENABLED <<<")

    # --- Load Config ---
    config = config_loader.load_config(config_file)
    if not config:
        log.critical("Failed to load any configuration. Aborting.")
        raise typer.Exit(code=1)
    log.debug(f"Configuration loaded from {config_file}")

    # --- TODO: Load State ---
    # state = state_manager.load_state(DEFAULT_STATE_PATH)
    _state = STATE  # Use placeholder variable marked as unused for now

    # --- Orchestration ---
    all_ok = True
    current_section = "Initialization"

    # Define sequence of tasks/sections
    # Structure: (Section Name, Config Key to Enable, Task Function/Module)
    # We will add more sections here later
    setup_sections = [
        ("Homebrew", "install_brew", brew_tasks),
        ("Mise", "mise_global_tools", mise_tasks),
        # ("SystemTweaks", "add_aliases", system_tasks), # Example future steps
        # ("Security", "setup_security", security_tasks),
        # ("Networking", "setup_networking", network_tasks),
    ]

    try:
        for name, config_key, task_module in setup_sections:
            current_section = name
            # Check if section is enabled by presence/truthiness of its main config key
            # (Use a more specific enable flag like "enable_brew_section": true later if needed)
            if config.get(config_key):
                log.info(f"--- Running Section: {current_section} ---")

                # --- Call specific functions within the task module ---
                if name == "Homebrew":
                    if not task_module.is_brew_installed():
                        if not task_module.install_brew(dry_run=dry_run):
                            raise Exception("Failed to install Homebrew.")
                    else:
                        log.info("Homebrew already installed.")
                    if not task_module.ensure_brew_shellenv(dry_run=dry_run):
                        raise Exception("Failed to configure Homebrew shellenv.")
                    if config.get("update_brew_on_run", True):
                        task_module.update_brew(dry_run=dry_run)  # non-fatal
                    if not task_module.install_formulae(
                        config.get("brew_formulae", []), dry_run=dry_run
                    ):
                        raise Exception("Failed during Homebrew formulae installation.")
                    if not task_module.install_casks(
                        config.get("brew_casks", []), dry_run=dry_run
                    ):
                        raise Exception("Failed during Homebrew cask installation.")

                elif name == "Mise":
                    if not task_module.setup_mise_globals(
                        config.get("mise_global_tools", {}), dry_run=dry_run
                    ):
                        raise Exception("Failed to setup Mise global tools.")
                    if config.get("configure_shell_activation", True):
                        shell_cfg = config.get("shell_config_file", "~/.zshrc")
                        if not task_module.ensure_mise_activation(
                            shell_config_file=shell_cfg, dry_run=dry_run
                        ):
                            raise Exception(
                                f"Failed to configure Mise shell activation in {shell_cfg}."
                            )

                # --- Add elif blocks for other sections here ---

                # TODO: Update state - state_manager.mark_complete(current_section)
                log.info(f"--- Section {current_section} Completed ---")

            else:
                log.info(
                    f"--- Skipping Section: {current_section} (Not configured or disabled) ---"
                )
                # TODO: Update state - state_manager.mark_skipped(current_section)

    except Exception as e:
        log.error(f"--- Section '{current_section}' FAILED ---")
        log.error(f"Error: {e}", exc_info=verbose)  # Show traceback if verbose
        # TODO: Implement diagnostics call here
        # if not dry_run: run_ollama_diagnostics(current_section, failure_context)
        all_ok = False

    # --- Final Summary ---
    if all_ok:
        log.info("=== Apex Level Setup Completed Successfully ===")
        # TODO: Print final status dashboard
    else:
        log.error("=== Apex Level Setup FAILED ===")
        raise typer.Exit(code=1)  # Exit with non-zero code on failure


@app.command(name="generate-config")
def generate_config_command(
    force: Annotated[
        bool, typer.Option("--force", help="Overwrite existing config file.")
    ] = False,
):
    """
    Generates a default config file at ~/.config/nextlevelapex/config.json
    """
    config_path = DEFAULT_CONFIG_PATH
    if force and config_path.is_file():
        log.warning(f"Overwriting existing config file at {config_path}")
        try:
            config_path.unlink()
        except OSError as e:
            log.error(f"Failed to remove existing config: {e}")
            raise typer.Exit(code=1)

    log.info(f"Attempting to generate default config at {config_path}...")
    if config_loader.generate_default_config(config_path):
        typer.echo(f"Default config generated successfully at {config_path}")
    else:
        typer.echo("Failed to generate config file.", err=True)
        raise typer.Exit(code=1)


# --- Main Execution Guard ---
if __name__ == "__main__":
    app()
