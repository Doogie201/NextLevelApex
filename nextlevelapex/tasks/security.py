"""
Security‑related setup tasks for NextLevelApex
=============================================

Current features
----------------
* Enable macOS firewall “stealth mode”.
* Allow Touch‑ID for `sudo`.

All functions conform to the @task decorator contract.
"""

from __future__ import annotations

# ── Standard library ────────────────────────────────────────────────────────
import logging
import shlex
import subprocess
from pathlib import Path
from typing import Dict

# ── Local imports ───────────────────────────────────────────────────────────
from nextlevelapex.main import TaskContext, TaskResult, task  # noqa: WPS433

log = logging.getLogger(__name__)

# ── Constants ───────────────────────────────────────────────────────────────
FIREWALL_UTIL = "/usr/libexec/ApplicationFirewall/socketfilterfw"
PAM_SUDO_FILE = Path("/etc/pam.d/sudo")
PAM_TID_LINE = "auth       sufficient     pam_tid.so"


# ── Helpers ────────────────────────────────────────────────────────────────
def _security_config(ctx: TaskContext) -> Dict:
    """Return the `security` section of the global config (or {})."""
    return ctx["config"].get("security", {})


def _run_sudo(cmd: list[str], dry_run: bool) -> subprocess.CompletedProcess[str]:
    """Wrapper that prints and executes sudo commands."""
    if dry_run:
        log.info("[dry‑run] sudo cmd: %s", shlex.join(cmd))
        return subprocess.CompletedProcess(cmd, 0, "", "")

    # Hard fail on non‑zero
    return subprocess.run(
        cmd, check=True, text=True, capture_output=True
    )  # noqa: S603,S607


# ── Task implementations ───────────────────────────────────────────────────
@task("Security")
def security_task(ctx: TaskContext) -> TaskResult:
    """
    Aggregate security‑related tweaks.

    Returns TaskResult(success=False) if any sub‑task fails.
    """
    cfg = _security_config(ctx)
    dry = ctx["dry_run"]

    sub_results: list[bool] = [
        _firewall_stealth(cfg, dry),
        _enable_touchid_sudo(cfg, dry),
        # add more here
    ]
    ok = all(sub_results)
    return TaskResult(name="Security", success=ok, changed=any(sub_results))


# --------------------------------------------------------------------------
# Individual subtasks
# --------------------------------------------------------------------------
def _firewall_stealth(cfg: Dict, dry_run: bool) -> bool:
    """Enable macOS firewall stealth mode if requested."""
    if not cfg.get("enable_firewall_stealth", False):
        log.debug("Firewall stealth mode skipped by config.")
        return False

    log.info("Enabling macOS firewall stealth mode …")
    cmd = ["sudo", FIREWALL_UTIL, "--setstealthmode", "on"]

    try:
        _run_sudo(cmd, dry_run)
        log.info("Firewall stealth mode enabled.")
        return True
    except subprocess.CalledProcessError as exc:
        log.error("Failed to enable firewall stealth mode: %s", exc.stderr)
        return False


def _enable_touchid_sudo(cfg: Dict, dry_run: bool) -> bool:
    """Add pam_tid.so line to /etc/pam.d/sudo to allow Touch‑ID sudo."""
    if not cfg.get("enable_touchid_sudo", False):
        log.debug("Touch‑ID sudo skipped by config.")
        return False

    log.info("Ensuring Touch‑ID is enabled for sudo …")

    # Already present?
    try:
        if PAM_SUDO_FILE.read_text().find(PAM_TID_LINE) != -1:
            log.info("Touch‑ID sudo already configured.")
            return False  # no change
    except PermissionError:
        log.debug("Need sudo to read %s – continuing", PAM_SUDO_FILE)

    # Append line using sudo tee
    pam_line = f"{PAM_TID_LINE}\n"
    shell_cmd = (
        f"printf '%s' {shlex.quote(pam_line)} | "
        f"sudo /usr/bin/tee -a {shlex.quote(str(PAM_SUDO_FILE))} >/dev/null"
    )
    log.debug("Running shell: %s", shell_cmd)
    if dry_run:
        log.info("[dry‑run] Would run: %s", shell_cmd)
        return True

    try:
        subprocess.run(shell_cmd, shell=True, check=True, text=True)  # noqa: S602
        log.info("Touch‑ID sudo rule added.")
        return True
    except subprocess.CalledProcessError as exc:
        log.error("Failed to add pam_tid.so rule: %s", exc.stderr)
        return False
