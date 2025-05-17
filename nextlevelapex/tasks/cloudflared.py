# ~/Projects/NextLevelApex/nextlevelapex/tasks/cloudflared.py
"""
Stand-up Cloudflared DoH/DoQ proxy on 127.0.0.1:5053.
– Installs cloudflared (via Homebrew) if missing
– Drops a templated LaunchAgent
– Bootstraps it with launchctl
– Self-heals: verifies port 5053 answers a DNS query; restarts agent once if not
"""

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskContext, TaskResult

log = LoggerProxy(__name__)

LA_LABEL = "com.local.doh"
LA_PATH = Path.home() / "Library" / "LaunchAgents" / f"{LA_LABEL}.plist"
TEMPLATE = (
    Path(__file__).resolve().parent.parent.parent  # project root
    / "assets"
    / "launch_agents"
    / "com.local.doh.plist.j2"
)

CLOUDFLARED_BIN = Path("/opt/homebrew/bin/cloudflared")  # default arm64 prefix


@task("Cloudflared DoH")
def setup_cloudflared(context: TaskContext) -> TaskResult:
    dry_run: bool = context["dry_run"]
    msgs, changed, ok = [], False, True

    ## 1) Ensure cloudflared installed
    if not CLOUDFLARED_BIN.exists():
        msgs.append((Severity.INFO, "Installing cloudflared via brew…"))
        res = run_command(["brew", "install", "cloudflared"], dry_run=dry_run)
        changed |= res.success
        if not res.success:
            msgs.append((Severity.ERROR, "brew install cloudflared failed"))
            return TaskResult("Cloudflared DoH", False, changed, msgs)

    ## 2) Render LaunchAgent from template
    if not TEMPLATE.exists():
        msgs.append((Severity.ERROR, f"Template missing: {TEMPLATE}"))
        return TaskResult("Cloudflared DoH", False, changed, msgs)

    if not dry_run:
        content = TEMPLATE.read_text().replace(
            "{{CLOUDFLARED_BIN}}", str(CLOUDFLARED_BIN)
        )
        if LA_PATH.read_text() if LA_PATH.exists() else "" != content:
            LA_PATH.write_text(content)
            changed = True
            msgs.append((Severity.INFO, f"Wrote launch agent to {LA_PATH}"))
        LA_PATH.chmod(0o644)
    else:
        msgs.append((Severity.DRYRUN, f"Would write {LA_PATH}"))

    ## 3) (Re)load LaunchAgent
    unload = ["launchctl", "bootout", f"gui/{os.getuid()}", str(LA_PATH)]
    load = ["launchctl", "bootstrap", f"gui/{os.getuid()}", str(LA_PATH)]

    run_command(unload, dry_run=dry_run, check=False)
    res = run_command(load, dry_run=dry_run, check=True)
    changed |= res.success
    if not res.success:
        msgs.append((Severity.ERROR, "launchctl bootstrap failed"))
        return TaskResult("Cloudflared DoH", False, changed, msgs)

    ## 4) Health-check port 5053
    if not dry_run and not _dig_ok():
        # one retry
        run_command(unload, check=False)
        run_command(load, check=False)
        if not _dig_ok():
            msgs.append((Severity.ERROR, "cloudflared not answering on 127.0.0.1:5053"))
            ok = False
        else:
            changed = True
            msgs.append((Severity.INFO, "cloudflared answered after restart"))

    return TaskResult("Cloudflared DoH", ok, changed, msgs)


def _dig_ok() -> bool:
    """Return True if dig @127.0.0.1 -p 5053 cloudflare.com succeeds within 2 s."""
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
