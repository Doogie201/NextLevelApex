#!/usr/bin/env python3

import typer
import json
import subprocess
import sys
import os
import logging
from pathlib import Path
from typing_extensions import Annotated

# --- Basic Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

# --- Configuration Placeholder ---
# TODO: Implement proper loading from ~/.config/nextlevelapex/config.json
DEFAULT_CONFIG = {
    "install_brew": True,
    "brew_formulae": ["mise", "docker", "colima", "jq", "ollama"],
    "brew_casks": ["warp", "raycast"],
    "setup_networking": True,
    "pihole_enabled": True,
    "doh_method": "pihole_builtin", # Options: 'pihole_builtin', 'host_cloudflared', 'none'
    "pihole_password": "changeme_in_config",
    "ollama_models": ["mistral:7b"],
    "force_ipv4_git": True, # Auto-configure git for IPv4 if networking setup might have issues
    # ... many more options ...
}

# --- State Management Placeholder ---
# TODO: Implement reading/writing state from ~/.config/nextlevelapex/state.json
STATE = {"completed_sections": []}

# --- Command Runner Placeholder ---
# TODO: Implement robust command running with error handling, logging, dry-run
def run_command(cmd_list: list[str], dry_run: bool = False, check: bool = True):
    cmd_str = " ".join(cmd_list)
    logging.info(f"Running: {cmd_str}")
    if dry_run:
        print(f"DRYRUN: Would execute: {cmd_str}")
        return True # Assume success for dry run sequence

    try:
        # In a real version, capture stdout/stderr, handle timeouts etc.
        process = subprocess.run(cmd_list, check=check, capture_output=True, text=True)
        if process.stdout:
            logging.debug(f"STDOUT: {process.stdout.strip()}")
        if process.stderr:
            logging.debug(f"STDERR: {process.stderr.strip()}")
        return True
    except subprocess.CalledProcessError as e:
        logging.error(f"Command failed with exit code {e.returncode}: {cmd_str}")
        logging.error(f"STDERR: {e.stderr.strip()}")
        return False
    except FileNotFoundError:
        logging.error(f"Command not found: {cmd_list[0]}")
        return False

# --- Task Module Placeholders ---
# TODO: Create separate modules for tasks (brew_tasks.py, network_tasks.py etc.)
def run_brew_tasks(config, state, dry_run, verbose):
    logging.info("--- Starting Brew Tasks ---")
    if not config.get("install_brew", False):
        logging.info("Skipping Brew tasks per config.")
        return True
    # ... add brew bootstrap, install formulae/casks logic ...
    # Use run_command([...], dry_run=dry_run)
    logging.info("--- Finished Brew Tasks ---")
    return True # Return True on success

def run_network_tasks(config, state, dry_run, verbose):
    logging.info("--- Starting Networking Tasks ---")
    if not config.get("setup_networking", False):
        logging.info("Skipping Networking tasks per config.")
        return True
    # ... Implement the complex logic here ...
    #    - Detect services, IPs
    #    - Configure DoH (based on config['doh_method'])
    #    - Configure Pi-hole (if config['pihole_enabled'])
    #        - Use docker SDK or run_command for docker
    #        - Use run_command for docker exec pihole ...
    #        - Set DNSMASQ_LISTENING=all
    #    - Set system DNS
    #    - Auto Git IPv4 config if needed
    logging.info("--- Finished Networking Tasks ---")
    return True # Return True on success


# --- Main CLI App ---
app = typer.Typer(help="Apex Level macOS Setup Orchestrator")

@app.command()
def run(
    config_file: Annotated[Path, typer.Option(help="Path to JSON configuration file.")] = Path.home() / ".config" / "nextlevelapex" / "config.json",
    dry_run: Annotated[bool, typer.Option("--dry-run", "-n", help="Print commands without executing.")] = False,
    verbose: Annotated[bool, typer.Option("--verbose", "-v", help="Enable verbose output.")] = False,
    resume: Annotated[bool, typer.Option(help="Attempt to resume from last failed step.")] = False,
    force_section: Annotated[str, typer.Option(help="Force specific section(s) to run, comma-separated.")] = "",
):
    """
    Run the Apex Level setup process.
    """
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    logging.info("Starting Apex Level Setup...")
    if dry_run:
        logging.info(">>> DRY RUN MODE ENABLED <<<")

    # TODO: Load config properly from config_file
    config = DEFAULT_CONFIG
    logging.info(f"Using configuration (placeholder): {config_file}")

    # TODO: Load state properly if resume is True
    state = STATE

    # --- Orchestration ---
    # TODO: Implement proper section running with state checking/saving
    # and dependency management.
    sections = {
        "Brew": run_brew_tasks,
        "Networking": run_network_tasks,
        # ... Add other sections/task functions ...
    }

    sections_to_run = force_section.split(',') if force_section else sections.keys()

    all_ok = True
    for section_name in sections_to_run:
      if section_name in sections:
          logging.info(f"=== Running Section: {section_name} ===")
          # TODO: Add check for previous success from state if not forced/resuming
          if not sections[section_name](config, state, dry_run, verbose):
              logging.error(f"Section '{section_name}' failed.")
              all_ok = False
              # TODO: Save state indicating failure
              # TODO: Implement optional Ollama diagnostics here
              # if not dry_run: run_ollama_diagnostics(section_name, failure_context)
              break # Stop on first failure for now
          # TODO: Save state indicating success
      else:
          logging.warning(f"Unknown section specified: {section_name}")


    if all_ok:
        logging.info("=== Apex Level Setup Completed Successfully ===")
        # TODO: Print final status dashboard
    else:
        logging.error("=== Apex Level Setup FAILED ===")

if __name__ == "__main__":
    app()
