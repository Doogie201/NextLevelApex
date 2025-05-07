# ~/Projects/NextLevelApex/nextlevelapex/tasks/launch_agents.py

import logging
import os  # Need to import 'os' for _manage_launch_agent
import stat  # For chmod
from pathlib import Path
from typing import Dict

from nextlevelapex.core.command import run_command

log = logging.getLogger(__name__)


# --- Helper to write script files ---
def _write_executable_script(script_path: Path, content: str, dry_run: bool) -> bool:
    log.info(f"Ensuring script exists and is executable: {script_path}")
    if dry_run:
        log.info(f"DRYRUN: Would write script to {script_path} and chmod +x.")
        print(f"\n--- DRYRUN: Content for {script_path} ---")
        print(content.strip())
        print("--- End DRYRUN ---")
        return True
    try:
        script_path.parent.mkdir(parents=True, exist_ok=True)
        with script_path.open("w") as f:
            f.write(content)
        # Make executable: current_mode | owner_execute | group_execute | other_execute
        current_mode = script_path.stat().st_mode
        script_path.chmod(current_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        log.info(f"Script {script_path} written and made executable.")
        return True
    except Exception as e:
        log.error(f"Failed to write or chmod script {script_path}: {e}")
        return False


# --- Helper to manage LaunchAgents ---
def _manage_launch_agent(
    plist_name: str,  # e.g., "com.nextlevelapex.batteryalert.plist"
    plist_content: str,
    dry_run: bool,
) -> bool:
    launch_agents_dir = Path.home() / "Library" / "LaunchAgents"
    plist_path = launch_agents_dir / plist_name
    label = plist_name.removesuffix(
        ".plist"
    )  # Convention: Label is filename without .plist

    log.info(f"Managing LaunchAgent: {label} at {plist_path}")

    if dry_run:
        log.info(f"DRYRUN: Would write plist to {plist_path}.")
        print(f"\n--- DRYRUN: Content for {plist_path} ---")
        print(plist_content.strip())
        print("--- End DRYRUN ---")
        log.info(f"DRYRUN: Would lint {plist_path}.")
        log.info(f"DRYRUN: Would bootout/bootstrap {label} using {plist_path}.")
        return True

    try:
        launch_agents_dir.mkdir(parents=True, exist_ok=True)
        with plist_path.open("w") as f:
            f.write(plist_content)
        log.info(f"Plist file {plist_path} written.")
    except Exception as e:
        log.error(f"Failed to write plist file {plist_path}: {e}")
        return False

    # Lint the plist
    lint_result = run_command(
        ["plutil", "-lint", str(plist_path)], dry_run=False, check=False
    )
    if not lint_result.success:
        log.error(
            f"Plist file {plist_path} failed linting.Stderr:\n{lint_result.stderr}"
        )
        return False
    log.info(f"Plist file {plist_path} linted successfully.")

    # Unload/bootout any existing agent with the same label
    # We use the label for bootout as it's more robust if path changed
    # We use the plist path for bootstrap as it's required
    user_id = str(os.geteuid())  # Get current user ID for launchctl domain
    log.info(f"Attempting to bootout existing agent: gui/{user_id}/{label}")
    run_command(
        ["launchctl", "bootout", f"gui/{user_id}/{label}"], dry_run=False, check=False
    )  # Ignore errors if not loaded

    # Load/bootstrap the new agent
    log.info(f"Attempting to bootstrap agent: gui/{user_id}/{plist_path}")
    bootstrap_result = run_command(
        ["launchctl", "bootstrap", f"gui/{user_id}", str(plist_path)],
        dry_run=False,
        check=True,
    )
    if bootstrap_result.success:
        log.info(f"LaunchAgent {label} bootstrapped successfully.")
    else:
        log.warning(f"Failed to bootstrap {label}. Attempting legacy load...")
        legacy_load_result = run_command(
            ["launchctl", "load", "-w", str(plist_path)], dry_run=False, check=True
        )
        if legacy_load_result.success:
            log.info(f"LaunchAgent {label} loaded using legacy 'load -w'.")
        else:
            log.error(
                f"Failed to load LaunchAgent {label} with bootstrap or legacy load."
            )
            return False
    return True


# --- Battery Alert Agent ---
def setup_battery_alert_agent(config: Dict, dry_run: bool = False) -> bool:
    """Sets up a LaunchAgent to monitor battery levels."""
    agents_config = config.get("automation_agents", {})
    battery_config = agents_config.get("battery_alert", {})

    if not battery_config.get("enable", False):
        log.info("Skipping battery alert agent setup as per config.")
        return True

    log.info("Setting up battery alert LaunchAgent...")
    script_path_str = battery_config.get(
        "script_path", "~/Scripts/NextLevelApex/battery_alert.sh"
    )
    script_path = Path(script_path_str).expanduser().resolve()
    threshold = battery_config.get("threshold_percent", 85)
    interval = battery_config.get("check_interval_seconds", 1800)

    battery_script_content = f"""#!/usr/bin/env zsh
# Check battery percentage and alert if above threshold
# Threshold: {threshold}%

# Get battery percentage (works on M-series Macs, adjust if needed for Intel)
PERCENTAGE=$(pmset -g batt | grep -Eo "\\d+%" | cut -d% -f1)
CHARGING_STATUS=$(pmset -g batt | grep -o "'.*'")

# Only notify if not charging and above threshold
if [[ "$PERCENTAGE" -gt {threshold} && "$CHARGING_STATUS" != *'(Charging)'* && "$CHARGING_STATUS" != *'(AC Power)'* ]]; then
  osascript -e 'display notification "Battery at {threshold}%+. Unplug to preserve health." with title "Battery Monitor"'
fi
"""
    if not _write_executable_script(script_path, battery_script_content, dry_run):
        return False

    plist_name = "com.nextlevelapex.batteryalert.plist"
    label = plist_name.removesuffix(".plist")
    battery_plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{script_path}</string>
  </array>
  <key>StartInterval</key>
  <integer>{interval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{Path.home()}/Library/Logs/NextLevelApex/{label}.log</string>
  <key>StandardErrorPath</key>
  <string>{Path.home()}/Library/Logs/NextLevelApex/{label}.err.log</string>
</dict>
</plist>
"""
    return _manage_launch_agent(plist_name, battery_plist_content, dry_run)


# --- Weekly Audit Agent ---
def setup_weekly_audit_agent(config: Dict, dry_run: bool = False) -> bool:
    """Sets up a LaunchAgent for a weekly audit script."""
    agents_config = config.get("automation_agents", {})
    audit_config = agents_config.get("weekly_audit", {})

    if not audit_config.get("enable", False):
        log.info("Skipping weekly audit agent setup as per config.")
        return True

    log.info("Setting up weekly audit LaunchAgent...")
    script_path_str = audit_config.get(
        "script_path", "~/Scripts/NextLevelApex/weekly_audit.sh"
    )
    script_path = Path(script_path_str).expanduser().resolve()
    audit_main_script = Path(
        audit_config.get("audit_script_path", "~/Tools/macDeepDive.sh")
    ).expanduser()
    audit_log_dir = Path(audit_config.get("log_directory", "~/AuditLogs")).expanduser()
    git_commit = audit_config.get("git_commit_audit", True)
    schedule = audit_config.get(
        "schedule", {"Weekday": 1, "Hour": 9, "Minute": 0}
    )  # Default Monday 9 AM

    weekly_audit_script_content = f"""#!/usr/bin/env zsh
# Weekly Audit Script
AUDIT_SCRIPT="{audit_main_script}"
LOG_DIR="{audit_log_dir}"
DATE_FORMAT=$(date +%F_%H-%M)
LOG_FILE="$LOG_DIR/$DATE_FORMAT.txt"
GIT_COMMIT_ENABLED={"true" if git_commit else "false"}

mkdir -p "$LOG_DIR"

if [[ ! -x "$AUDIT_SCRIPT" ]]; then
  echo "Error: Audit script $AUDIT_SCRIPT not found or not executable." >&2
  exit 1
fi

echo "Running audit on $DATE_FORMAT, logging to $LOG_FILE..."
"$AUDIT_SCRIPT" > "$LOG_FILE" 2>&1

if [[ "$GIT_COMMIT_ENABLED" == "true" ]]; then
  cd "$LOG_DIR" || exit 1
  if [[ ! -d .git ]]; then
    echo "Initializing Git repository in $LOG_DIR..."
    git init
    git config user.name "NextLevelApex Audit" || true # Best effort
    git config user.email "audit@$(hostname -s || echo localhost)" || true # Best effort
  fi
  git add .
  git commit -m "Automated audit log: $DATE_FORMAT" || echo "No changes to commit in audit logs."
fi
echo "Weekly audit complete."
"""
    if not _write_executable_script(script_path, weekly_audit_script_content, dry_run):
        return False

    plist_name = "com.nextlevelapex.weeklyaudit.plist"
    label = plist_name.removesuffix(".plist")
    weekly_audit_plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{script_path}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>{schedule.get("Weekday", 1)}</integer>
    <key>Hour</key><integer>{schedule.get("Hour", 9)}</integer>
    <key>Minute</key><integer>{schedule.get("Minute", 0)}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/> <key>StandardOutPath</key>
  <string>{Path.home()}/Library/Logs/NextLevelApex/{label}.log</string>
  <key>StandardErrorPath</key>
  <string>{Path.home()}/Library/Logs/NextLevelApex/{label}.err.log</string>
</dict>
</plist>
"""
    return _manage_launch_agent(plist_name, weekly_audit_plist_content, dry_run)
