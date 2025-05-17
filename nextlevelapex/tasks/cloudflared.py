# ~/Projects/NextLevelApex/nextlevelapex/tasks/cloudflared.py
"""
Stand‑up a local Cloudflared DNS‑over‑HTTPS/QUIC proxy that listens on
**127.0.0.1:5053**.

Key features
------------
* Ensures *cloudflared* is installed via Homebrew (arm64 default prefix).
* Renders a **LaunchAgent** from a Jinja2 template →
  ``~/Library/LaunchAgents/com.local.doh.plist``.
* (Re)loads the agent with *launchctl* and performs a health‑check.
* Attempts one automatic restart if the health‑check fails (self‑heal).
"""

from __future__ import annotations

# ── Standard library ──────────────────────────────────────────────────
import os
import subprocess
import time
from pathlib import Path
from typing import List

# ── Third‑party ───────────────────────────────────────────────────────
from jinja2 import Environment, FileSystemLoader, Template, select_autoescape

# ── Local imports ─────────────────────────────────────────────────────
from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskContext, TaskResult

log = LoggerProxy(__name__)

# ── Constants ─────────────────────────────────────────────────────────
LA_LABEL = "com.local.doh"
LA_PATH = Path.home() / "Library" / "LaunchAgents" / f"{LA_LABEL}.plist"
TEMPLATE = (
    Path(__file__).resolve().parent.parent.parent  # project root
    / "assets"
    / "launch_agents"
    / "com.local.doh.plist.j2"
)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TEMPLATE_DIR = PROJECT_ROOT / "assets" / "launch_agents"
TEMPLATE_NAME = "com.local.doh.plist.j2"
CLOUDFLARED_BIN = Path("/opt/homebrew/bin/cloudflared")  # default for Apple‑Silicon
LOG_PATH = Path.home() / "Library" / "Logs" / "com.local.doh.log"

# ---------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------


def _render_template() -> str:
    """Render the LaunchAgent plist using Jinja2."""
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(enabled_extensions=(".j2",)),
    )
    template = env.get_template(TEMPLATE_NAME)
    return template.render(cloudflared_bin=str(CLOUDFLARED_BIN))


def _write_launch_agent(content: str) -> None:
    LA_PATH.parent.mkdir(parents=True, exist_ok=True)
    LA_PATH.write_text(content)
    LA_PATH.chmod(0o644)


def _reload_launch_agent(dry_run: bool) -> bool:
    """Unload + load the agent.  Returns *True* on success."""
    unload = ["launchctl", "bootout", f"gui/{os.getuid()}", str(LA_PATH)]
    load = ["launchctl", "bootstrap", f"gui/{os.getuid()}", str(LA_PATH)]
    run_command(unload, dry_run=dry_run, check=False)
    res = run_command(load, dry_run=dry_run, check=True)
    return res.success


def _dig_ok() -> bool:
    """Return *True* if a dig query via 127.0.0.1:5053 succeeds within 2 s."""
    try:
        proc = subprocess.run(
            [
                "dig",
                "+time=2",
                "+tries=1",
                "@127.0.0.1",
                "-p",
                "5053",
                "cloudflare.com",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        return "NOERROR" in proc.stdout
    except FileNotFoundError:
        return False


# ---------------------------------------------------------------------
# Task implementation
# ---------------------------------------------------------------------


@task("Cloudflared DoH")
def setup_cloudflared(
    context: TaskContext,
) -> TaskResult:  # noqa: C901  — complexity ok
    dry_run: bool = context["dry_run"]
    messages: List[tuple[Severity, str]] = []
    changed = False
    success = True

    # 1️⃣  Ensure cloudflared present ------------------------------------------------
    if not CLOUDFLARED_BIN.exists():
        messages.append((Severity.INFO, "Installing cloudflared via brew…"))
        res = run_command(["brew", "install", "cloudflared"], dry_run=dry_run)
        changed |= res.success
        if not res.success:
            messages.append((Severity.ERROR, "brew install cloudflared failed"))
            return TaskResult("Cloudflared DoH", False, changed, messages)

    # 2️⃣  Render & write LaunchAgent ----------------------------------------------
    if not TEMPLATE.exists():
        messages.append((Severity.ERROR, f"Template missing: {TEMPLATE}"))
        return TaskResult("Cloudflared DoH", False, changed, messages)

    if not dry_run:
        template_txt = TEMPLATE.read_text()
        plist = Template(template_txt).render(
            CLOUDFLARED_BIN=str(CLOUDFLARED_BIN),
            LOG_PATH=str(Path.home() / "Library" / "Logs" / "com.local.doh.log"),
        )

        if LA_PATH.read_text() if LA_PATH.exists() else "" != plist:
            LA_PATH.write_text(plist)
            changed = True
            messages.append((Severity.INFO, f"Launch agent written to {LA_PATH}"))
        LA_PATH.chmod(0o644)

    # 3️⃣  Reload agent -------------------------------------------------------------
    if not _reload_launch_agent(dry_run):
        messages.append((Severity.ERROR, "launchctl bootstrap failed"))
        return TaskResult("Cloudflared DoH", False, changed, messages)

    # 4️⃣  Health‑check & self‑heal -------------------------------------------------
    if not dry_run:
        # cloudflared can need ~1 s before it binds the socket;
        # poll up to 3 s (6×0.5 s) before declaring failure.
        for _ in range(6):
            if _dig_ok():
                break
            time.sleep(0.5)
        else:  # still not answering → one controlled restart
            _reload_launch_agent(dry_run=False)
            for _ in range(6):
                if _dig_ok():
                    changed = True
                    messages.append(
                        (Severity.INFO, "cloudflared responded after restart")
                    )
                    break
                time.sleep(0.5)
            else:
                messages.append(
                    (Severity.ERROR, "cloudflared not answering on 127.0.0.1:5053")
                )
                success = False

    return TaskResult("Cloudflared DoH", success, changed, messages)
