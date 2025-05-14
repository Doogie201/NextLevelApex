# ~/Projects/NextLevelApex/nextlevelapex/tasks/mise.py

import logging
from pathlib import Path
from typing import Dict

from nextlevelapex.core.command import run_command
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskResult
from nextlevelapex.main import TaskContext

log = logging.getLogger(__name__)


def setup_mise_globals(tools: Dict[str, str], dry_run: bool = False) -> bool:
    log.debug(f"setup_mise_globals received dict: {tools} (Type: {type(tools)})")
    if not tools:
        log.info("No Mise global tools specified in config.")
        return True

    tool_args = [f"{name}@{version}" for name, version in tools.items()]
    log.info(f"Setting global Mise tools: {', '.join(tool_args)}...")

    cmd = ["mise", "use", "--global"] + tool_args
    result = run_command(cmd, dry_run=dry_run, check=True)

    if not result.success:
        log.error("Failed to set global Mise tools.")
        return False

    cmd_install = ["mise", "install"]
    log.info("Ensuring Mise global tools are installed...")
    result_install = run_command(cmd_install, dry_run=dry_run, check=True)

    if not result_install.success:
        log.error("Failed to install global Mise tools after setting versions.")
        return False

    log.info("Mise global tools setup finished.")
    return True


@task("Mise Globals")
def setup_mise_globals_task(ctx: TaskContext) -> TaskResult:
    tools = (
        ctx["config"].get("developer_tools", {}).get("mise", {}).get("global_tools", {})
    )
    success = setup_mise_globals(tools=tools, dry_run=ctx["dry_run"])
    messages = []
    if not success:
        messages.append((Severity.ERROR, "Failed to write mise globals"))
    return TaskResult(
        name="Mise Globals",
        success=success,
        changed=success and not ctx["dry_run"],
        messages=messages,
    )


def ensure_mise_activation(
    shell_config_file: str = "~/.zshrc",
    dry_run: bool = False,
) -> bool:
    activation_line = 'eval "$(mise activate zsh)"'
    config_path = Path(shell_config_file).expanduser().resolve()

    log.info(f"Ensuring Mise activation command is in {config_path}...")

    if not config_path.parent.exists():
        log.warning(
            f"Parent directory for {config_path} does not exist. Cannot check/add activation line."
        )
        return True

    line_found = False
    if config_path.is_file():
        try:
            with open(config_path, "r") as f:
                for line in f:
                    if activation_line in line and not line.strip().startswith("#"):
                        line_found = True
                        break
        except Exception as e:
            log.error(f"Error reading {config_path}: {e}")

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
                return False
        else:
            log.info(f"DRYRUN: Would add Mise activation line to {config_path}.")
            return True
