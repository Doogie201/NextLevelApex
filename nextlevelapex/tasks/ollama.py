# ~/Projects/NextLevelApex/nextlevelapex/tasks/ollama.py

import logging
from typing import Dict

from nextlevelapex.core.command import run_command
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskResult

log = logging.getLogger(__name__)


def setup_ollama(config: Dict, dry_run: bool = False) -> bool:
    """Installs Ollama and pulls specified models."""
    local_ai_config = config.get("local_ai", {})
    ollama_config = local_ai_config.get("ollama", {})

    if not ollama_config.get("enable", False):
        log.info("Skipping Ollama setup as per config.")
        return True

    log.info("Setting up Ollama...")

    # 1. Install Ollama formula (if not already handled by main brew task)
    #    It's good practice to ensure it here if this module can run independently.
    #    The main brew_tasks.install_formulae should ideally cover 'ollama'.
    #    If it's already installed, brew install will just say so.
    log.info("Ensuring Ollama brew formula is installed...")
    install_result = run_command(
        ["brew", "install", "ollama"], dry_run=dry_run, check=True
    )
    if (
        not install_result.success and not dry_run
    ):  # Check for actual failure if not dry run
        log.error("Failed to install Ollama via Homebrew.")
        return False
    log.info("Ollama formula check/install complete.")

    # 2. Start Ollama service
    if ollama_config.get("start_service", True):
        log.info("Ensuring Ollama service is started...")
        # `brew services start` is generally idempotent
        # It will report if already started or start it.
        # We use check=False because it can return non-zero if already started
        # but we want to log the actual output.
        service_result = run_command(
            ["brew", "services", "start", "ollama"], dry_run=dry_run, check=False
        )
        if service_result.returncode != 0 and not dry_run:
            log.warning(
                f"Brew services start ollama command finished with RC={service_result.returncode}. Output:\n{service_result.stdout}\n{service_result.stderr}"
            )
            # This might not be a fatal error if already running correctly.
            # A more robust check would be `brew services list | grep ollama | grep started`
        elif dry_run and service_result.success:  # Dry run reports success
            log.info("DRYRUN: Ollama service would be started.")
        else:
            log.info("Ollama service start command executed.")

    # 3. Pull models
    models_to_pull = ollama_config.get("models_to_pull", [])
    if not models_to_pull:
        log.info("No Ollama models specified to pull in config.")
        return True

    all_models_pulled = True
    for model_name in models_to_pull:
        log.info(f"Pulling Ollama model: {model_name}...")
        # `ollama pull` can take a long time; no timeout specified here
        pull_result = run_command(
            ["ollama", "pull", model_name], dry_run=dry_run, check=True
        )
        if not pull_result.success:
            log.error(f"Failed to pull Ollama model: {model_name}")
            all_models_pulled = False  # Continue trying other models
            # Optionally, could make this a fatal error by returning False here

    if all_models_pulled:
        log.info("All specified Ollama models pulled successfully (or dry run).")
    else:
        log.warning("One or more Ollama models failed to pull.")
        # Decide if this is a fatal overall failure for the section
        # For now, let's say the section "completed" if ollama itself is installed/running.

    return True  # Return True if Ollama setup process itself completed, even if a model pull failed


@task("Ollama Setup")
def setup_ollama_task(ctx) -> TaskResult:
    # call your existing bool‐returning setup_ollama()
    success = setup_ollama(ctx["config"].get("local_ai", {}), dry_run=ctx["dry_run"])
    messages = []
    if not success:
        messages.append((Severity.ERROR, "Ollama installation or pull failed"))
    return TaskResult(
        name="Ollama Setup",
        success=success,
        changed=success and not ctx["dry_run"],
        messages=messages,
    )
