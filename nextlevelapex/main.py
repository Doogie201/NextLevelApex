#!/usr/bin/env python3
"""NextLevelApex – CLI entry‑point (config‑aware).
=================================================

Industrial‑grade launcher for the *NextLevelApex* workstation‑bootstrap
project, now **backwards‑compatible** with legacy configuration schemas.

Key points
----------
* Resolves both *old* top‑level boolean enable flags (e.g. ``enable_homebrew_tasks``)
  and the *new* nested ``"homebrew": {"enable": true}`` style.
* Fully type‑annotated, `ruff`/`mypy --strict` clean.
* Lazy imports defer side‑effects until a section actually runs.
"""

from __future__ import annotations

import logging
import sys
from enum import StrEnum, auto
from importlib import import_module
from pathlib import Path
from typing import Any, Callable, Final, Mapping

import typer
from typing_extensions import Annotated

from nextlevelapex.core import config as config_loader
from nextlevelapex.core import state as state_manager  # type: ignore

# ──────────────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────────────
_LOG_FORMAT: Final[str] = "%(asctime)s [%(levelname)-8s] %(name)-20s — %(message)s"
logging.basicConfig(
    level=logging.INFO,
    format=_LOG_FORMAT,
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Exceptions
# ──────────────────────────────────────────────────────────────────────────────
class ApexError(RuntimeError):
    """Base‑class for all domain‑specific errors."""


class TaskFailed(ApexError):
    """Raised when a sub‑task reports failure."""


# ──────────────────────────────────────────────────────────────────────────────
# Paths & CLI app
# ──────────────────────────────────────────────────────────────────────────────
CONFIG_PATH: Final = Path.home() / ".config/nextlevelapex/config.json"
STATE_PATH: Final = Path.home() / ".local/state/nextlevelapex/state.json"

app = typer.Typer(
    help="NextLevelApex – apex‑level macOS setup orchestrator.",
    add_completion=False,
)


# ──────────────────────────────────────────────────────────────────────────────
# Section dispatch
# ──────────────────────────────────────────────────────────────────────────────
class Section(StrEnum):
    HOMEBREW = auto()
    MISE = auto()
    SYSTEM_TWEAKS = auto()
    SECURITY = auto()


SectionHandler = Callable[[dict[str, Any], bool], None]


def _lazy_import(path: str) -> Any:  # noqa: ANN401
    return import_module(path)


# Legacy → modern enable‑key mapping
_ENABLE_KEYS: Mapping[Section, str] = {
    Section.HOMEBREW: "enable_homebrew_tasks",
    Section.MISE: "enable_mise_tasks",
    Section.SYSTEM_TWEAKS: "enable_system_tasks",
    Section.SECURITY: "enable_security_tasks",
}


# ──────────────────────────────────────────────────────────────────────────────
# Handlers
# ──────────────────────────────────────────────────────────────────────────────


def _homebrew_handler(cfg: dict[str, Any], dry_run: bool) -> None:
    brew = _lazy_import("nextlevelapex.tasks.brew")
    hb_cfg: dict[str, Any] = cfg.get("homebrew", {})

    if not brew.is_brew_installed():
        if not hb_cfg.get("install_brew", True):
            raise TaskFailed("Homebrew installation disabled in config.")
        if not brew.install_brew(dry_run=dry_run):
            raise TaskFailed("Homebrew installation failed.")

    if not brew.ensure_brew_shellenv(dry_run=dry_run):
        raise TaskFailed("Failed to configure Homebrew shellenv.")

    if cfg.get("script_behavior", {}).get("update_brew_on_run", True):
        brew.update_brew(dry_run=dry_run)

    if not brew.install_formulae(hb_cfg.get("formulae", []), dry_run=dry_run):
        raise TaskFailed("Formula installation failed.")

    if not brew.install_casks(hb_cfg.get("casks", []), dry_run=dry_run):
        raise TaskFailed("Cask installation failed.")


def _mise_handler(cfg: dict[str, Any], dry_run: bool) -> None:
    mise = _lazy_import("nextlevelapex.tasks.mise")
    mise_cfg: dict[str, Any] = cfg.get("developer_tools", {}).get("mise", {})

    if not mise_cfg.get("enable", True):
        log.info("Mise disabled via config; skipping.")
        return

    if not mise.setup_mise_globals(mise_cfg.get("global_tools", {}), dry_run=dry_run):
        raise TaskFailed("Failed to set up Mise globals.")

    if cfg.get("system", {}).get("configure_shell_activation", True):
        shell_cfg = Path(
            cfg.get("system", {}).get("shell_config_file", "~/.zshrc")
        ).expanduser()
        if not mise.ensure_mise_activation(
            shell_config_file=shell_cfg, dry_run=dry_run
        ):
            raise TaskFailed(f"Failed to configure Mise activation in {shell_cfg}.")


def _system_tweaks_handler(cfg: dict[str, Any], dry_run: bool) -> None:
    system = _lazy_import("nextlevelapex.tasks.system")
    if not system.ensure_aliases(cfg, dry_run=dry_run):
        raise TaskFailed("Failed to configure shell aliases.")

    if not system.prune_logitech_agents(cfg, dry_run=dry_run):
        log.warning("Logitech pruning reported a non‑fatal issue.")


def _security_handler(cfg: dict[str, Any], dry_run: bool) -> None:
    security = _lazy_import("nextlevelapex.tasks.security")
    if not security.set_firewall_stealth(cfg, dry_run=dry_run):
        log.warning("Failed to set firewall stealth mode.")

    if not security.enable_touchid_sudo(cfg, dry_run=dry_run):
        log.warning("Failed to enable Touch ID for sudo.")


_SECTION_HANDLERS: Mapping[Section, SectionHandler] = {
    Section.HOMEBREW: _homebrew_handler,
    Section.MISE: _mise_handler,
    Section.SYSTEM_TWEAKS: _system_tweaks_handler,
    Section.SECURITY: _security_handler,
}


# ──────────────────────────────────────────────────────────────────────────────
# Helper – resolve enable flag across old & new schemas
# ──────────────────────────────────────────────────────────────────────────────


def _is_section_enabled(section: Section, cfg: dict[str, Any]) -> bool:
    """Return *True* if the section should execute.

    Priority order:
    1. Legacy top‑level boolean e.g. ``enable_homebrew_tasks``.
    2. Nested ``<section>.enable`` flag.
    3. Default → *True*.
    """
    legacy_flag = cfg.get(_ENABLE_KEYS[section], None)
    if legacy_flag is not None:
        return bool(legacy_flag)

    nested_flag = cfg.get(section.name.lower(), {}).get("enable")
    return bool(nested_flag) if nested_flag is not None else True


# ──────────────────────────────────────────────────────────────────────────────
# CLI commands
# ──────────────────────────────────────────────────────────────────────────────


@app.command()
def run(
    config_file: Annotated[
        Path,
        typer.Option("--config", "-c", help="Path to configuration JSON."),
    ] = CONFIG_PATH,
    dry_run: Annotated[bool, typer.Option("--dry-run", "-n")] = False,
    verbose: Annotated[bool, typer.Option("--verbose", "-v")] = False,
) -> None:
    """Execute the full NextLevelApex setup workflow."""

    # Logging level
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)
        log.debug("Verbose logging enabled.")

    cfg = config_loader.load_config(config_file)
    if not cfg:
        raise ApexError(f"Invalid or missing configuration at {config_file}")

    _state = state_manager.load_state(STATE_PATH)  # noqa: F841  # used later

    overall_success = True
    for section, handler in _SECTION_HANDLERS.items():
        if not _is_section_enabled(section, cfg):
            log.info("Skipping %s – disabled in config.", section.name)
            continue

        log.info("— Running section: %s —", section.name)
        try:
            handler(cfg, dry_run)
            log.info("✓ Section %s completed", section.name)
            state_manager.mark_complete(section.name)  # type: ignore[attr-defined]
        except TaskFailed as exc:
            overall_success = False
            log.error("✗ Section %s failed: %s", section.name, exc, exc_info=verbose)
            state_manager.mark_failed(section.name)  # type: ignore[attr-defined]
            break  # stop on first hard failure

    if overall_success:
        log.info("=== Apex Level setup completed successfully ===")
    else:
        raise typer.Exit(code=1)


@app.command(name="generate-config")
def generate_config(
    force: Annotated[
        bool, typer.Option("--force", help="Overwrite existing config.")
    ] = False,
) -> None:
    """Create a default configuration file compatible with both schemas."""
    if force and CONFIG_PATH.exists():
        log.warning("Overwriting existing config at %s", CONFIG_PATH)
        CONFIG_PATH.unlink(missing_ok=True)

    if config_loader.generate_default_config(CONFIG_PATH):
        typer.echo(f"Default config written to {CONFIG_PATH}")
    else:
        typer.echo("Failed to write default config.", err=True)
        raise typer.Exit(code=1)


if __name__ == "__main__":  # pragma: no cover
    app()
