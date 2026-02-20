# ~/Projects/NextLevelApex/nextlevelapex/tasks/optional.py

from pathlib import Path

from nextlevelapex.core.command import run_command
from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.registry import task
from nextlevelapex.core.task import Severity, TaskResult

log = LoggerProxy(__name__)


@task("YubiKey SSH Setup")
def setup_yubikey_ssh_task(ctx: dict) -> TaskResult:
    config = ctx.get("config", {})
    dry_run = ctx.get("dry_run", False)
    success = setup_yubikey_ssh(config=config, dry_run=dry_run)

    messages = []
    if not success:
        messages.append((Severity.WARNING, "YubiKey SSH key setup failed or skipped."))

    return TaskResult(
        name="YubiKey SSH Setup",
        success=True,
        changed=success and not dry_run,
        messages=messages,
    )


def setup_yubikey_ssh(config: dict, dry_run: bool = False) -> bool:
    security_config = config.get("security", {})
    yubikey_config = security_config.get("yubikey", {})

    if not yubikey_config.get("enable_ssh_key_generation", False):
        log.info("Skipping YubiKey SSH key generation as per config.")
        return True

    log.info("Attempting YubiKey SSH key generation...")

    key_path = (
        Path(yubikey_config.get("ssh_key_filename", "~/.ssh/id_ed25519_sk_nlx"))
        .expanduser()
        .resolve()
    )

    if not dry_run:
        try:
            key_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        except Exception as e:
            log.error(f"Failed to create directory {key_path.parent}: {e}")
            return False

    cmd = [
        "ssh-keygen",
        "-t",
        "ed25519-sk",
        "-f",
        str(key_path),
        "-N",
        "",
        "-O",
        "resident",
        "-O",
        "application=ssh",
    ]

    if yubikey_config.get("require_touch", True):
        cmd.extend(["-O", "verify-required"])
        log.info("Configuring with verify-required (touch).")
    else:
        log.info("Configuring without verify-required (less secure).")

    result = run_command(cmd, dry_run=dry_run, check=False)

    if not dry_run:
        if result.success:
            log.info(f"YubiKey SSH key successfully generated at {key_path}.")
        elif any(
            term in result.stderr.lower()
            for term in ["no fido2 device", "no fido device", "no sk keys"]
        ):
            log.warning("No FIDO2 device detected. Skipping.")
            return True
        else:
            log.error(f"YubiKey SSH keygen failed with RC={result.returncode}")
            log.error(result.stderr)
            return True
    else:
        log.info(f"DRYRUN: Would generate key at {key_path}.")

    return True
