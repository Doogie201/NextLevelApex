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
from nextlevelapex.core.task import Severity, TaskResult
from nextlevelapex.main import TaskContext  # noqa: WPS433
from nextlevelapex.main import task  # ensure decorator is available

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
    result = TaskResult("security", True, False)
    for fn in (_firewall_stealth, _enable_touchid_sudo):
        sub = fn(ctx)
        if not sub.success:
            result.success = False
        if sub.changed:
            result.changed = True
        result.messages.extend(sub.messages)
    return result


# --------------------------------------------------------------------------
# Individual subtasks
# --------------------------------------------------------------------------
def _firewall_stealth(cfg: dict, dry_run: bool) -> TaskResult:
    """
    Enable macOS firewall stealth mode if requested.
    Returns a TaskResult with detailed messages and change status.
    """
    result = TaskResult(name="security.firewall_stealth", success=True, changed=False)
    if not cfg.get("enable_firewall_stealth", False):
        result.messages.append((Severity.INFO, "Firewall stealth disabled in config"))
        return result

    cmd = [FIREWALL_UTIL, "--setstealthmode", "on"]
    if dry_run:
        result.messages.append(
            (Severity.INFO, f"[dry-run] would run: sudo {' '.join(cmd)}")
        )
        return result

    try:
        subprocess.run(["sudo"] + cmd, check=True, text=True, capture_output=True)
        result.changed = True
        result.messages.append((Severity.INFO, "Enabled firewall stealth mode"))
    except subprocess.CalledProcessError as exc:
        result.success = False
        err = exc.stderr or exc.stdout or str(exc)
        result.messages.append(
            (Severity.ERROR, f"Failed to enable firewall stealth mode: {err}")
        )
    return result


def _enable_touchid_sudo(cfg: dict, dry_run: bool) -> TaskResult:
    """
    Add pam_tid.so line to /etc/pam.d/sudo to allow Touch-ID sudo.
    Returns a TaskResult with details and change status.
    """
    result = TaskResult(name="security.touchid_sudo", success=True, changed=False)
    if not cfg.get("enable_touchid_sudo", False):
        result.messages.append((Severity.INFO, "Touch-ID sudo disabled in config"))
        return result

    # Check if already present
    try:
        content = PAM_SUDO_FILE.read_text()
        if PAM_TID_LINE in content:
            result.messages.append((Severity.INFO, "Touch-ID sudo already configured"))
            return result
    except PermissionError:
        result.messages.append(
            (Severity.INFO, f"No read access to {PAM_SUDO_FILE}, proceeding")
        )

    pam_line = f"{PAM_TID_LINE}\n"
    if dry_run:
        result.changed = True
        result.messages.append(
            (
                Severity.INFO,
                f"[dry-run] would append line to {PAM_SUDO_FILE}: {PAM_TID_LINE}",
            )
        )
        return result

    shell_cmd = (
        f"printf '%s' {shlex.quote(pam_line)} | "
        f"sudo /usr/bin/tee -a {shlex.quote(str(PAM_SUDO_FILE))} >/dev/null"
    )
    try:
        subprocess.run(
            shell_cmd, shell=True, check=True, text=True, capture_output=True
        )
        result.changed = True
        result.messages.append((Severity.INFO, "Added Touch-ID sudo rule"))
    except subprocess.CalledProcessError as exc:
        result.success = False
        err = exc.stderr or exc.stdout or str(exc)
        result.messages.append(
            (Severity.ERROR, f"Failed to add pam_tid.so rule: {err}")
        )
    return result
