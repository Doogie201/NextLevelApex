from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from jinja2 import Template

from nextlevelapex.core.task import Severity

EXPECTED_RESOLVER_IP = "192.168.64.2"
PIHOLE_CONTAINER = "pihole"
PIHOLE_DATA = "pihole_data"
DNSMASQ_DATA = "pihole_dnsmasq_data"
PIHOLE_IMAGE = (
    "pihole/pihole@sha256:ee348529cea9601df86ad94d62a39cad26117e1eac9e82d8876aa0ec7fe1ba27"
)
PIHOLE_UPSTREAM = "host.docker.internal#5053"
PIHOLE_WEB_PORT = 8080
CLOUDFLARED_REQUIRED_VERSION = "2025.5.0"
CLOUDFLARED_ADDRESS = "127.0.0.1"
CLOUDFLARED_PORT = 5053
CLOUDFLARED_UPSTREAMS = (
    "https://1.1.1.1/dns-query",
    "https://1.0.0.1/dns-query",
)
CLOUDFLARED_PREFERRED_BIN = Path("/opt/homebrew/bin/cloudflared")
CLOUDFLARED_BOOTSTRAP_BIN_DIR = Path.home() / ".local" / "share" / "nextlevelapex" / "bin"
CLOUDFLARED_BOOTSTRAP_CACHE_DIR = Path.home() / ".cache" / "nextlevelapex" / "cloudflared"
CLOUDFLARED_RELEASE_BASE_URL = "https://github.com/cloudflare/cloudflared/releases/download"
CLOUDFLARED_RELEASE_METADATA_URL = (
    "https://api.github.com/repos/cloudflare/cloudflared/releases/tags"
)
LEGACY_CONTAINERS = ("cloudflared", "unbound")
PASSWORD_PATH = Path.home() / ".config" / "nextlevelapex" / "pihole_admin_password"
LAUNCH_AGENT_LABEL = "com.local.doh"
LAUNCH_AGENT_PATH = Path.home() / "Library" / "LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist"
LAUNCH_AGENT_BACKUP_PATH = (
    Path.home() / "Library" / "LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist.bak"
)
LAUNCH_AGENT_LOG = Path.home() / "Library" / "Logs" / "com.local.doh.log"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
LAUNCH_AGENT_TEMPLATE = PROJECT_ROOT / "assets" / "launch_agents" / "com.local.doh.plist.j2"
CHROMIUM_BROWSER_SUPPORT_DIRS = (
    ("Google Chrome", ("Library", "Application Support", "Google", "Chrome")),
    ("Microsoft Edge", ("Library", "Application Support", "Microsoft Edge")),
    ("Brave Browser", ("Library", "Application Support", "BraveSoftware", "Brave-Browser")),
)
FIREFOX_PROFILE_DIR = ("Library", "Application Support", "Firefox", "Profiles")


@dataclass(frozen=True)
class CommandOutcome:
    cmd: list[str]
    returncode: int
    stdout: str
    stderr: str

    @property
    def success(self) -> bool:
        return self.returncode == 0


@dataclass
class StepResult:
    success: bool
    changed: bool = False
    messages: list[tuple[Severity, str]] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DNSSettings:
    enabled: bool
    resolver_ip: str
    set_system_dns: bool
    pihole_image: str
    pihole_upstream: str
    pihole_web_port: int
    password_env_var: str
    default_web_password: str
    cloudflared_address: str
    cloudflared_port: int
    cloudflared_required_version: str
    cloudflared_upstreams: tuple[str, ...]
    cloudflared_binary_path: Path
    cloudflared_bootstrap_bin_dir: Path
    cloudflared_bootstrap_cache_dir: Path
    cloudflared_release_base_url: str
    cloudflared_release_metadata_url: str


@dataclass
class CloudflaredBinaryResult:
    success: bool
    changed: bool = False
    path: Path | None = None
    source: str | None = None
    brew_managed: bool = False
    messages: list[tuple[Severity, str]] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)


def load_dns_settings(config: dict[str, Any]) -> tuple[DNSSettings, list[tuple[Severity, str]]]:
    networking = config.get("networking", {})
    pihole_cfg = networking.get("pihole", {})
    cloudflared_cfg = networking.get("cloudflared_host_agent", {})
    messages: list[tuple[Severity, str]] = []

    doh_method = networking.get("doh_method", "host_cloudflared")
    if doh_method != "host_cloudflared":
        messages.append(
            (
                Severity.WARNING,
                f"networking.doh_method={doh_method} is legacy for the single-device DNS stack; enforcing host_cloudflared.",
            )
        )

    settings = DNSSettings(
        enabled=networking.get("enable", True) and pihole_cfg.get("enable", True),
        resolver_ip=networking.get("resolver_ip", EXPECTED_RESOLVER_IP),
        set_system_dns=networking.get("set_system_dns", True),
        pihole_image=pihole_cfg.get("image", PIHOLE_IMAGE),
        pihole_upstream=pihole_cfg.get("upstream", PIHOLE_UPSTREAM),
        pihole_web_port=int(pihole_cfg.get("web_port", PIHOLE_WEB_PORT)),
        password_env_var=pihole_cfg.get("web_password_env_var", "NLX_PIHOLE_PASSWORD"),
        default_web_password=pihole_cfg.get(
            "default_web_password",
            "CHANGE_THIS_PASSWORD_NOW",
        ),
        cloudflared_address=cloudflared_cfg.get("listen_address", CLOUDFLARED_ADDRESS),
        cloudflared_port=int(cloudflared_cfg.get("listen_port", CLOUDFLARED_PORT)),
        cloudflared_required_version=cloudflared_cfg.get(
            "required_version",
            CLOUDFLARED_REQUIRED_VERSION,
        ),
        cloudflared_upstreams=tuple(cloudflared_cfg.get("upstreams", list(CLOUDFLARED_UPSTREAMS))),
        cloudflared_binary_path=expand_path(
            cloudflared_cfg.get("binary_path", str(CLOUDFLARED_PREFERRED_BIN))
        ),
        cloudflared_bootstrap_bin_dir=expand_path(
            cloudflared_cfg.get("bootstrap_bin_dir", str(CLOUDFLARED_BOOTSTRAP_BIN_DIR))
        ),
        cloudflared_bootstrap_cache_dir=expand_path(
            cloudflared_cfg.get("bootstrap_cache_dir", str(CLOUDFLARED_BOOTSTRAP_CACHE_DIR))
        ),
        cloudflared_release_base_url=str(
            cloudflared_cfg.get("release_base_url", CLOUDFLARED_RELEASE_BASE_URL)
        ).rstrip("/"),
        cloudflared_release_metadata_url=str(
            cloudflared_cfg.get("release_metadata_url", CLOUDFLARED_RELEASE_METADATA_URL)
        ).rstrip("/"),
    )
    return settings, messages


def expand_path(value: str) -> Path:
    return Path(str(value)).expanduser()


def orchestrate_dns_stack(config: dict[str, Any], dry_run: bool = False) -> StepResult:
    settings, config_messages = load_dns_settings(config)
    if not settings.enabled:
        return StepResult(
            success=True,
            changed=False,
            messages=[*config_messages, (Severity.INFO, "Canonical DNS stack disabled in config.")],
        )

    preflight = capture_runtime_snapshot()
    messages = list(config_messages)
    changed = False
    evidence: dict[str, Any] = {"preflight": preflight}

    colima_plan = inspect_colima_runtime(settings)
    pihole_plan = inspect_pihole_container(settings)
    resolver_health = (
        canonical_resolver_health(settings)
        if EXPECTED_RESOLVER_IP in preflight.get("configured_resolvers", [])
        else {"success": True, "skipped": "canonical resolver not configured preflight"}
    )
    evidence["preflight_resolver_health"] = resolver_health
    disruptive = needs_temporary_dns_release(
        preflight.get("configured_resolvers", []),
        colima_plan.get("restart_required", False),
        pihole_plan.get("recreate_required", False),
        resolver_outage_detected=not resolver_health.get("success", True),
    )

    if disruptive and preflight.get("active_service"):
        if not resolver_health.get("success", True):
            messages.append(
                (
                    Severity.WARNING,
                    f"Canonical resolver {settings.resolver_ip} is unhealthy; temporarily releasing manual DNS to recover name resolution before repair.",
                )
            )
        release = set_network_service_dns(preflight["active_service"], [], dry_run=dry_run)
        messages.extend(release.messages)
        changed |= release.changed
        evidence["temporary_dns_release"] = release.evidence
        if not release.success:
            return StepResult(False, changed, messages, evidence)
        if not dry_run:
            release_validation = validate_temporary_dns_recovery()
            evidence["temporary_dns_release_validation"] = release_validation
            if not release_validation["success"]:
                messages.append(
                    (
                        Severity.ERROR,
                        "Temporary DNS release did not restore general name resolution for repair.",
                    )
                )
                return StepResult(False, changed, messages, evidence)
            messages.append(
                (
                    Severity.INFO,
                    "Temporary DNS release restored general name resolution for repair.",
                )
            )

    cloudflared = ensure_cloudflared_service(settings, dry_run=dry_run)
    messages.extend(cloudflared.messages)
    changed |= cloudflared.changed
    evidence["cloudflared"] = cloudflared.evidence
    if not cloudflared.success:
        return StepResult(False, changed, messages, evidence)

    colima = ensure_colima_runtime(config, settings, dry_run=dry_run)
    messages.extend(colima.messages)
    changed |= colima.changed
    evidence["colima"] = colima.evidence
    if not colima.success:
        return StepResult(False, changed, messages, evidence)

    docker_context = ensure_docker_context_colima(dry_run=dry_run)
    messages.extend(docker_context.messages)
    changed |= docker_context.changed
    evidence["docker_context"] = docker_context.evidence
    if not docker_context.success:
        return StepResult(False, changed, messages, evidence)

    legacy = remove_legacy_containers(dry_run=dry_run)
    messages.extend(legacy.messages)
    changed |= legacy.changed
    evidence["legacy_cleanup"] = legacy.evidence
    if not legacy.success:
        return StepResult(False, changed, messages, evidence)

    pihole = ensure_pihole_container(settings, dry_run=dry_run)
    messages.extend(pihole.messages)
    changed |= pihole.changed
    evidence["pihole"] = pihole.evidence
    if not pihole.success:
        return StepResult(False, changed, messages, evidence)

    direct_validation = validate_dns_stack(settings, require_default_resolver=False)
    evidence["direct_validation"] = direct_validation.evidence
    messages.extend(direct_validation.messages)
    if not direct_validation.success:
        return StepResult(False, changed, messages, evidence)

    active_service = preflight.get("active_service")
    if settings.set_system_dns and active_service:
        resolver = set_network_service_dns(
            active_service,
            [settings.resolver_ip],
            dry_run=dry_run,
        )
        messages.extend(resolver.messages)
        changed |= resolver.changed
        evidence["mac_resolver"] = resolver.evidence
        if not resolver.success:
            return StepResult(False, changed, messages, evidence)

    final_validation = validate_dns_stack(
        settings,
        require_default_resolver=settings.set_system_dns,
    )
    evidence["final_validation"] = final_validation.evidence
    evidence["postflight"] = capture_runtime_snapshot()
    messages.extend(final_validation.messages)
    return StepResult(final_validation.success, changed, messages, evidence)


def ensure_cloudflared_service(settings: DNSSettings, dry_run: bool = False) -> StepResult:
    messages: list[tuple[Severity, str]] = []
    evidence: dict[str, Any] = {}
    changed = False

    binary = ensure_cloudflared_binary(settings, dry_run=dry_run)
    messages.extend(binary.messages)
    changed |= binary.changed
    evidence["cloudflared_binary"] = binary.evidence
    if not binary.success or binary.path is None:
        return StepResult(False, changed, messages, evidence)

    if binary.brew_managed and brew_available():
        if dry_run:
            messages.append((Severity.INFO, "Would pin cloudflared in Homebrew if needed."))
        else:
            if not is_brew_pinned("cloudflared"):
                pin = _run(["brew", "pin", "cloudflared"], timeout=60)
                evidence["brew_pin"] = _serialize_command(pin)
                if not pin.success:
                    messages.append((Severity.ERROR, "Failed to pin cloudflared in Homebrew."))
                    return StepResult(False, changed, messages, evidence)
                changed = True
                messages.append((Severity.INFO, "Pinned cloudflared in Homebrew."))

    if brew_available() and is_brew_formula_installed("cloudflared"):
        if dry_run:
            messages.append((Severity.INFO, "Would stop the default Homebrew cloudflared service."))
        else:
            stop_service = _run(["brew", "services", "stop", "cloudflared"], timeout=60)
            evidence["brew_service_stop"] = _serialize_command(stop_service)

    legacy_cleanup = remove_legacy_containers(
        dry_run=dry_run,
        container_names=("cloudflared",),
    )
    messages.extend(legacy_cleanup.messages)
    changed |= legacy_cleanup.changed
    evidence["legacy_cloudflared_cleanup"] = legacy_cleanup.evidence
    if not legacy_cleanup.success:
        return StepResult(False, changed, messages, evidence)

    if not LAUNCH_AGENT_TEMPLATE.exists():
        messages.append((Severity.ERROR, f"Missing LaunchAgent template: {LAUNCH_AGENT_TEMPLATE}"))
        return StepResult(False, changed, messages, evidence)

    rendered = render_launch_agent(settings, binary.path)
    previous = LAUNCH_AGENT_PATH.read_text(encoding="utf-8") if LAUNCH_AGENT_PATH.exists() else None
    if previous != rendered:
        if dry_run:
            messages.append((Severity.INFO, "Would rewrite the cloudflared LaunchAgent."))
        else:
            LAUNCH_AGENT_PATH.parent.mkdir(parents=True, exist_ok=True)
            LAUNCH_AGENT_PATH.write_text(rendered, encoding="utf-8")
            LAUNCH_AGENT_PATH.chmod(0o644)
            changed = True
            messages.append((Severity.INFO, f"Updated LaunchAgent at {LAUNCH_AGENT_PATH}."))

    healthy = cloudflared_listener_healthy(settings)
    launchd_running = launch_agent_running()
    evidence["launchd_running"] = launchd_running
    evidence["listener_healthy"] = healthy
    if dry_run:
        messages.append((Severity.INFO, "Would reload the cloudflared LaunchAgent if unhealthy."))
        return StepResult(True, changed, messages, evidence)

    if changed or not launchd_running or not healthy:
        reload_result = reload_launch_agent()
        evidence["launch_agent_reload"] = reload_result
        if not reload_result["success"]:
            messages.append((Severity.ERROR, "launchctl failed to reload cloudflared LaunchAgent."))
            return StepResult(False, changed, messages, evidence)
        changed = True

    if not wait_for_cloudflared_health(settings):
        messages.append((Severity.ERROR, "cloudflared is not healthy on 127.0.0.1:5053."))
        return StepResult(False, changed, messages, evidence)

    messages.append((Severity.INFO, "cloudflared is healthy on 127.0.0.1:5053."))
    return StepResult(True, changed, messages, evidence)


def ensure_cloudflared_binary(
    settings: DNSSettings,
    dry_run: bool = False,
) -> CloudflaredBinaryResult:
    messages: list[tuple[Severity, str]] = []
    evidence: dict[str, Any] = {
        "required_version": settings.cloudflared_required_version,
        "preferred_binary": str(settings.cloudflared_binary_path),
        "bootstrap_bin_dir": str(settings.cloudflared_bootstrap_bin_dir),
        "bootstrap_cache_dir": str(settings.cloudflared_bootstrap_cache_dir),
    }
    release_url = cloudflared_release_url(settings)
    release_metadata_url = cloudflared_release_metadata_api_url(settings)
    evidence["bootstrap_release_url"] = release_url
    evidence["bootstrap_release_metadata_url"] = release_metadata_url

    versioned_target = (
        settings.cloudflared_bootstrap_bin_dir
        / f"cloudflared-{settings.cloudflared_required_version}"
    )
    stable_target = settings.cloudflared_bootstrap_bin_dir / "cloudflared"
    preferred_version = cloudflared_version(settings.cloudflared_binary_path)
    stable_version = cloudflared_version(stable_target)
    versioned_version = cloudflared_version(versioned_target)
    evidence["candidates"] = [
        {
            "label": "preferred",
            "path": str(settings.cloudflared_binary_path),
            "exists": settings.cloudflared_binary_path.exists(),
            "version": preferred_version,
        },
        {
            "label": "bootstrap_symlink",
            "path": str(stable_target),
            "exists": stable_target.exists() or stable_target.is_symlink(),
            "version": stable_version,
        },
        {
            "label": "bootstrap_versioned",
            "path": str(versioned_target),
            "exists": versioned_target.exists(),
            "version": versioned_version,
        },
    ]

    if preferred_version == settings.cloudflared_required_version:
        messages.append(
            (
                Severity.INFO,
                f"Using exact cloudflared {settings.cloudflared_required_version} from {settings.cloudflared_binary_path}.",
            )
        )
        return CloudflaredBinaryResult(
            success=True,
            changed=False,
            path=settings.cloudflared_binary_path,
            source="preferred",
            brew_managed=is_brew_formula_installed("cloudflared")
            and settings.cloudflared_binary_path == CLOUDFLARED_PREFERRED_BIN,
            messages=messages,
            evidence=evidence,
        )

    if versioned_version == settings.cloudflared_required_version:
        link_changed = ensure_bootstrap_symlink(stable_target, versioned_target, dry_run=dry_run)
        if link_changed:
            messages.append(
                (
                    Severity.INFO,
                    f"{'Would refresh' if dry_run else 'Refreshed'} cloudflared bootstrap symlink at {stable_target}.",
                )
            )
        return CloudflaredBinaryResult(
            success=True,
            changed=link_changed,
            path=stable_target if not dry_run else versioned_target,
            source="bootstrapped",
            brew_managed=False,
            messages=messages,
            evidence=evidence,
        )

    if stable_version == settings.cloudflared_required_version:
        messages.append(
            (
                Severity.INFO,
                f"Using exact bootstrapped cloudflared {settings.cloudflared_required_version} from {stable_target}.",
            )
        )
        return CloudflaredBinaryResult(
            success=True,
            changed=False,
            path=stable_target,
            source="bootstrapped",
            brew_managed=False,
            messages=messages,
            evidence=evidence,
        )

    evidence["bootstrap_versioned_target"] = str(versioned_target)
    evidence["bootstrap_symlink_target"] = str(stable_target)

    if preferred_version and preferred_version != settings.cloudflared_required_version:
        messages.append(
            (
                Severity.WARNING,
                f"Preferred cloudflared binary drifted: expected {settings.cloudflared_required_version}, observed {preferred_version} at {settings.cloudflared_binary_path}.",
            )
        )
    elif not settings.cloudflared_binary_path.exists():
        messages.append(
            (
                Severity.INFO,
                f"Preferred cloudflared binary is absent at {settings.cloudflared_binary_path}; bootstrap is required.",
            )
        )

    if release_url is None:
        messages.append(
            (
                Severity.ERROR,
                f"Unsupported platform for cloudflared bootstrap: system={platform.system()} arch={platform.machine()}",
            )
        )
        return CloudflaredBinaryResult(False, False, None, None, False, messages, evidence)

    if dry_run:
        messages.append(
            (
                Severity.INFO,
                f"Would bootstrap cloudflared {settings.cloudflared_required_version} from {release_url} to {stable_target}.",
            )
        )
        return CloudflaredBinaryResult(
            success=True,
            changed=True,
            path=stable_target,
            source="bootstrapped",
            brew_managed=False,
            messages=messages,
            evidence=evidence,
        )

    bootstrap = bootstrap_cloudflared_binary(settings, versioned_target, stable_target)
    evidence["bootstrap"] = bootstrap
    if not bootstrap.get("success"):
        messages.append(
            (
                Severity.ERROR,
                "cloudflared bootstrap failed. See evidence.bootstrap for the exact download/install failure.",
            )
        )
        return CloudflaredBinaryResult(False, False, None, None, False, messages, evidence)

    messages.append(
        (
            Severity.INFO,
            f"Bootstrapped exact cloudflared {settings.cloudflared_required_version} to {stable_target}.",
        )
    )
    return CloudflaredBinaryResult(
        success=True,
        changed=True,
        path=stable_target,
        source="bootstrapped",
        brew_managed=False,
        messages=messages,
        evidence=evidence,
    )


def ensure_colima_runtime(
    config: dict[str, Any],
    settings: DNSSettings,
    dry_run: bool = False,
) -> StepResult:
    messages: list[tuple[Severity, str]] = []
    evidence: dict[str, Any] = {}
    changed = False

    provider = config.get("developer_tools", {}).get("docker_runtime", {}).get("provider", "colima")
    if provider != "colima":
        messages.append(
            (
                Severity.ERROR,
                f"Docker provider {provider} is not supported by the canonical single-device DNS stack.",
            )
        )
        return StepResult(False, changed, messages, evidence)

    status = colima_status()
    evidence["before_status"] = status
    if status.get("running") and status.get("ip_address") == settings.resolver_ip:
        messages.append((Severity.INFO, f"Colima already exposes {settings.resolver_ip}."))
        return StepResult(True, changed, messages, evidence)

    dev_cfg = config.get("developer_tools", {}).get("docker_runtime", {}).get("colima", {})
    start_on_run = bool(dev_cfg.get("start_on_run", True))
    evidence["start_on_run"] = start_on_run
    start_cmd = build_colima_start_command(dev_cfg)
    evidence["start_command"] = start_cmd
    if not start_on_run:
        messages.append(
            (
                Severity.ERROR,
                "Colima runtime drift requires a restart/start, but developer_tools.docker_runtime.colima.start_on_run=false blocks that mutation.",
            )
        )
        return StepResult(False, changed, messages, evidence)
    if dry_run:
        messages.append((Severity.INFO, f"Would run {' '.join(start_cmd)}."))
        return StepResult(True, True, messages, evidence)

    if status.get("running"):
        stop = _run(["colima", "stop"], timeout=300)
        evidence["stop"] = _serialize_command(stop)
        if not stop.success:
            messages.append(
                (Severity.ERROR, "Failed to stop Colima before applying reachable-IP mode.")
            )
            return StepResult(False, changed, messages, evidence)
        changed = True
        messages.append((Severity.INFO, "Stopped Colima to reconcile reachable-IP mode."))

    start = _run(start_cmd, timeout=600)
    evidence["start"] = _serialize_command(start)
    if not start.success:
        messages.append(
            (Severity.ERROR, "Failed to start Colima with the canonical DNS address mode.")
        )
        return StepResult(False, changed, messages, evidence)
    changed = True

    verify = colima_status()
    evidence["after_status"] = verify
    if verify.get("ip_address") != settings.resolver_ip:
        messages.append(
            (
                Severity.ERROR,
                f"Colima address mismatch after start: expected {settings.resolver_ip}, observed {verify.get('ip_address') or 'unknown'}.",
            )
        )
        return StepResult(False, changed, messages, evidence)

    messages.append((Severity.INFO, f"Colima now exposes {settings.resolver_ip}."))
    return StepResult(True, changed, messages, evidence)


def ensure_docker_context_colima(dry_run: bool = False) -> StepResult:
    messages: list[tuple[Severity, str]] = []
    evidence: dict[str, Any] = {}
    context = docker_context()
    evidence["before_context"] = context
    if context == "colima":
        messages.append((Severity.INFO, "Docker context already set to colima."))
        return StepResult(True, False, messages, evidence)

    if dry_run:
        messages.append((Severity.INFO, "Would switch Docker context to colima."))
        return StepResult(True, True, messages, evidence)

    switch = _run(["docker", "context", "use", "colima"], timeout=30)
    evidence["switch"] = _serialize_command(switch)
    if not switch.success:
        messages.append((Severity.ERROR, "Failed to switch Docker context to colima."))
        return StepResult(False, False, messages, evidence)

    messages.append((Severity.INFO, "Switched Docker context to colima."))
    return StepResult(True, True, messages, evidence)


def ensure_pihole_container(settings: DNSSettings, dry_run: bool = False) -> StepResult:
    messages: list[tuple[Severity, str]] = []
    evidence: dict[str, Any] = {}
    changed = False

    evidence["password_path"] = str(PASSWORD_PATH)
    evidence["password_created"] = False

    inspect = inspect_pihole_container(settings)
    evidence["before_inspect"] = inspect
    recreate_required = inspect.get("recreate_required", True)
    if recreate_required:
        if dry_run:
            messages.append(
                (Severity.INFO, "Would recreate the Pi-hole container to match the canonical spec.")
            )
            changed = True
        else:
            password, password_created = resolve_pihole_password(settings)
            evidence["password_created"] = password_created
            if password_created:
                changed = True
                messages.append(
                    (Severity.INFO, f"Stored Pi-hole admin password at {PASSWORD_PATH}.")
                )
            pull = _run(["docker", "pull", settings.pihole_image], timeout=600)
            evidence["pull"] = _serialize_command(pull)
            if not pull.success:
                messages.append((Severity.ERROR, "Failed to pull the pinned Pi-hole image."))
                return StepResult(False, changed, messages, evidence)

            remove = _run(["docker", "rm", "-f", PIHOLE_CONTAINER], timeout=60)
            evidence["remove"] = _serialize_command(remove)
            volume_pihole = _run(["docker", "volume", "create", PIHOLE_DATA], timeout=30)
            volume_dnsmasq = _run(["docker", "volume", "create", DNSMASQ_DATA], timeout=30)
            evidence["volume_pihole"] = _serialize_command(volume_pihole)
            evidence["volume_dnsmasq"] = _serialize_command(volume_dnsmasq)

            run_cmd = [
                "docker",
                "run",
                "-d",
                "--name",
                PIHOLE_CONTAINER,
                "-p",
                f"{settings.resolver_ip}:53:53/tcp",
                "-p",
                f"{settings.resolver_ip}:53:53/udp",
                "-p",
                f"{settings.resolver_ip}:{settings.pihole_web_port}:80",
                "--restart",
                "unless-stopped",
                "-v",
                f"{PIHOLE_DATA}:/etc/pihole",
                "-v",
                f"{DNSMASQ_DATA}:/etc/dnsmasq.d",
                "-e",
                f"TZ={os.environ.get('TZ', 'America/New_York')}",
                "-e",
                f"WEBPASSWORD={password}",
                "-e",
                "FTLCONF_dns_listeningMode=ALL",
                "-e",
                f"DNS1={settings.pihole_upstream}",
                "-e",
                "DNS2=no",
                settings.pihole_image,
            ]
            create = _run(run_cmd, timeout=120)
            evidence["create"] = _serialize_command(create)
            if not create.success:
                messages.append((Severity.ERROR, "Failed to create the Pi-hole container."))
                return StepResult(False, changed, messages, evidence)
            changed = True
            messages.append(
                (Severity.INFO, "Recreated the Pi-hole container from the pinned image.")
            )

    if dry_run:
        messages.append(
            (Severity.INFO, "Would verify Pi-hole health and enforce upstream persistence.")
        )
        return StepResult(True, changed, messages, evidence)

    if not wait_for_pihole_health():
        messages.append((Severity.ERROR, "Pi-hole did not become healthy in time."))
        return StepResult(False, changed, messages, evidence)

    upstream = get_pihole_upstreams()
    evidence["before_upstream"] = upstream
    if settings.pihole_upstream not in upstream or len(upstream) != 1:
        set_result = set_pihole_upstream(settings.pihole_upstream)
        evidence["set_upstream"] = set_result
        if not set_result["success"]:
            messages.append((Severity.ERROR, "Failed to persist the canonical Pi-hole upstream."))
            return StepResult(False, changed, messages, evidence)
        restart = _run(["docker", "restart", PIHOLE_CONTAINER], timeout=60)
        evidence["restart"] = _serialize_command(restart)
        if not restart.success:
            messages.append((Severity.ERROR, "Failed to restart Pi-hole after upstream update."))
            return StepResult(False, changed, messages, evidence)
        changed = True
        if not wait_for_pihole_health():
            messages.append((Severity.ERROR, "Pi-hole did not recover after upstream update."))
            return StepResult(False, changed, messages, evidence)

    validation = validate_pihole_endpoints(settings)
    evidence["validation"] = validation
    if not validation["success"]:
        messages.append((Severity.ERROR, "Pi-hole endpoint validation failed."))
        return StepResult(False, changed, messages, evidence)

    messages.append(
        (
            Severity.INFO,
            f"Pi-hole is healthy on {settings.resolver_ip}:53 and :{settings.pihole_web_port}.",
        )
    )
    return StepResult(True, changed, messages, evidence)


def validate_dns_stack(settings: DNSSettings, require_default_resolver: bool) -> StepResult:
    evidence = {
        "udp": _run(["dig", f"@{settings.resolver_ip}", "example.com", "+short"], timeout=15),
        "tcp": _run(
            ["dig", "+tcp", f"@{settings.resolver_ip}", "example.com", "+short"], timeout=15
        ),
        "dnssec": _run(
            ["dig", f"@{settings.resolver_ip}", "dnssec-failed.org", "+dnssec"],
            timeout=15,
        ),
        "admin": _run(
            [
                "curl",
                "-I",
                "-s",
                f"http://{settings.resolver_ip}:{settings.pihole_web_port}/admin/",
            ],
            timeout=15,
        ),
        "cloudflared_example": _run(
            [
                "dig",
                f"@{settings.cloudflared_address}",
                "-p",
                str(settings.cloudflared_port),
                "example.com",
                "+short",
            ],
            timeout=15,
        ),
        "cloudflared_dnssec": _run(
            [
                "dig",
                f"@{settings.cloudflared_address}",
                "-p",
                str(settings.cloudflared_port),
                "dnssec-failed.org",
                "+dnssec",
            ],
            timeout=15,
        ),
        "pihole_upstream": _run(
            ["docker", "exec", PIHOLE_CONTAINER, "pihole-FTL", "--config", "dns.upstreams"],
            timeout=15,
        ),
        "default_server": _run(["dig", "example.com"], timeout=15),
        "connectivity": _run(["curl", "-sI", "https://example.com"], timeout=20),
        "containers": _run(["docker", "ps", "--format", "{{.Names}}"], timeout=10),
        "noncanonical_artifacts": audit_noncanonical_dns_artifacts(),
        "browser_dns_posture": audit_browser_dns_posture(),
    }
    messages: list[tuple[Severity, str]] = []

    udp_ok = evidence["udp"].success and bool(evidence["udp"].stdout.strip())
    tcp_ok = evidence["tcp"].success and bool(evidence["tcp"].stdout.strip())
    admin_ok = evidence["admin"].success and "302" in evidence["admin"].stdout
    dnssec_ok = "SERVFAIL" in evidence["dnssec"].stdout
    cloudflared_ok = evidence["cloudflared_example"].success and bool(
        evidence["cloudflared_example"].stdout.strip()
    )
    cloudflared_dnssec_ok = "SERVFAIL" in evidence["cloudflared_dnssec"].stdout
    upstream_ok = settings.pihole_upstream in evidence["pihole_upstream"].stdout
    containers = {
        line.strip() for line in evidence["containers"].stdout.splitlines() if line.strip()
    }
    no_conflicts = not any(name in containers for name in LEGACY_CONTAINERS)
    connectivity_ok = (
        evidence["connectivity"].success and "HTTP/" in evidence["connectivity"].stdout
    )
    default_server_ok = (
        not require_default_resolver
        or f"SERVER: {settings.resolver_ip}#53" in evidence["default_server"].stdout
    )

    if not udp_ok:
        messages.append((Severity.ERROR, "UDP queries to the Pi-hole resolver failed."))
    if not tcp_ok:
        messages.append((Severity.ERROR, "TCP queries to the Pi-hole resolver failed."))
    if not admin_ok:
        messages.append(
            (Severity.ERROR, "Pi-hole admin endpoint did not return the expected redirect.")
        )
    if not dnssec_ok:
        messages.append((Severity.ERROR, "Pi-hole did not return SERVFAIL for dnssec-failed.org."))
    if not cloudflared_ok or not cloudflared_dnssec_ok:
        messages.append((Severity.ERROR, "Host cloudflared listener validation failed."))
    if not upstream_ok:
        messages.append((Severity.ERROR, "Pi-hole upstream does not match the canonical DoH path."))
    if not no_conflicts:
        messages.append(
            (Severity.ERROR, "Legacy cloudflared/unbound containers are still running.")
        )
    if require_default_resolver and not default_server_ok:
        messages.append((Severity.ERROR, "macOS default resolver is not using 192.168.64.2."))
    if not connectivity_ok:
        messages.append((Severity.ERROR, "General internet connectivity check failed."))
    append_noncanonical_dns_artifact_messages(messages, evidence["noncanonical_artifacts"])
    append_browser_dns_posture_messages(messages, evidence["browser_dns_posture"])

    if not any(level is Severity.ERROR for level, _ in messages):
        messages.append((Severity.INFO, "Canonical single-device DNS stack validation passed."))

    return StepResult(
        success=not any(level is Severity.ERROR for level, _ in messages),
        changed=False,
        messages=messages,
        evidence={
            key: _serialize_command(value) if isinstance(value, CommandOutcome) else value
            for key, value in evidence.items()
        },
    )


def capture_runtime_snapshot() -> dict[str, Any]:
    active_service = active_network_service_name()
    configured_resolvers = (
        configured_dns_servers(active_service) if active_service is not None else []
    )
    default_server = _run(["dig", "example.com"], timeout=15)
    connectivity = _run(["curl", "-sI", "https://example.com"], timeout=20)
    listeners = _run(
        ["lsof", "-nP", "-iTCP:53", "-iUDP:53", "-iTCP:5053", "-iUDP:5053", "-sTCP:LISTEN"],
        timeout=20,
    )
    return {
        "active_service": active_service,
        "configured_resolvers": configured_resolvers,
        "docker_context": docker_context(),
        "colima": colima_status(),
        "containers": docker_ps_names(all_containers=False),
        "default_server": default_server.stdout,
        "connectivity": connectivity.stdout,
        "listeners": listeners.stdout,
        "noncanonical_artifacts": audit_noncanonical_dns_artifacts(),
        "browser_dns_posture": audit_browser_dns_posture(),
    }


def inspect_colima_runtime(settings: DNSSettings) -> dict[str, Any]:
    status = colima_status()
    return {
        "running": status.get("running", False),
        "ip_address": status.get("ip_address"),
        "restart_required": status.get("ip_address") != settings.resolver_ip,
    }


def inspect_pihole_container(settings: DNSSettings) -> dict[str, Any]:
    container = inspect_container(PIHOLE_CONTAINER)
    if not container:
        return {"present": False, "recreate_required": True}

    config = container.get("Config") or {}
    host_config = container.get("HostConfig") or {}
    state = container.get("State") or {}
    health = (state.get("Health") or {}).get("Status")

    recreate = False
    if config.get("Image") != settings.pihole_image:
        recreate = True

    port_bindings = host_config.get("PortBindings") or {}
    if not _has_binding(port_bindings, "53/tcp", settings.resolver_ip, "53"):
        recreate = True
    if not _has_binding(port_bindings, "53/udp", settings.resolver_ip, "53"):
        recreate = True
    if not _has_binding(
        port_bindings, "80/tcp", settings.resolver_ip, str(settings.pihole_web_port)
    ):
        recreate = True
    if (host_config.get("RestartPolicy") or {}).get("Name") != "unless-stopped":
        recreate = True
    if not state.get("Running") or health not in {"healthy", "starting", None}:
        recreate = True

    return {
        "present": True,
        "recreate_required": recreate,
        "image": config.get("Image"),
        "health": health,
        "running": state.get("Running", False),
    }


def needs_temporary_dns_release(
    configured_resolvers: list[str],
    colima_restart_required: bool,
    pihole_recreate_required: bool,
    resolver_outage_detected: bool = False,
) -> bool:
    return EXPECTED_RESOLVER_IP in configured_resolvers and (
        colima_restart_required or pihole_recreate_required or resolver_outage_detected
    )


def set_network_service_dns(
    service: str,
    servers: list[str],
    dry_run: bool = False,
) -> StepResult:
    messages: list[tuple[Severity, str]] = []
    evidence: dict[str, Any] = {"service": service, "servers": servers or ["Empty"]}
    current = configured_dns_servers(service)
    target = servers
    if current == target:
        messages.append((Severity.INFO, f"DNS for {service} already set to {target or ['Empty']}."))
        return StepResult(True, False, messages, evidence)

    if dry_run:
        messages.append((Severity.INFO, f"Would set DNS for {service} to {target or ['Empty']}."))
        return StepResult(True, True, messages, evidence)

    cmd = ["networksetup", "-setdnsservers", service]
    cmd.extend(servers or ["Empty"])
    set_result = _run(cmd, timeout=20)
    evidence["set"] = _serialize_command(set_result)
    if not set_result.success:
        messages.append((Severity.ERROR, f"Failed to set DNS for {service}."))
        return StepResult(False, False, messages, evidence)

    flush = _run(["killall", "-HUP", "mDNSResponder"], timeout=5)
    evidence["flush"] = _serialize_command(flush)
    messages.append((Severity.INFO, f"Set DNS for {service} to {target or ['Empty']}."))
    return StepResult(True, True, messages, evidence)


def active_network_service_name() -> str | None:
    route = _run(["route", "-n", "get", "default"], timeout=10)
    interface = None
    for line in route.stdout.splitlines():
        if "interface:" in line:
            interface = line.split(":", 1)[1].strip()
            break
    if not interface:
        services = _run(["networksetup", "-listallnetworkservices"], timeout=10)
        for line in services.stdout.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("*") and not stripped.startswith("An asterisk"):
                return stripped
        return None

    hardware = _run(["networksetup", "-listallhardwareports"], timeout=10)
    port = None
    device = None
    for line in hardware.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("Hardware Port:"):
            port = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("Device:"):
            device = stripped.split(":", 1)[1].strip()
            if device == interface and port:
                return port
    return None


def configured_dns_servers(service: str) -> list[str]:
    result = _run(["networksetup", "-getdnsservers", service], timeout=10)
    if not result.success:
        return []
    if "There aren't any DNS Servers set" in result.stdout:
        return []
    return re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", result.stdout)


def docker_context() -> str | None:
    result = _run(["docker", "context", "show"], timeout=10)
    return result.stdout.strip() if result.success and result.stdout.strip() else None


def docker_command(args: list[str], context: str | None = None) -> list[str]:
    cmd = ["docker"]
    if context:
        cmd.extend(["--context", context])
    cmd.extend(args)
    return cmd


def legacy_container_contexts() -> list[str]:
    contexts: list[str] = []
    for candidate in (docker_context(), "colima", "default"):
        if candidate and candidate not in contexts:
            contexts.append(candidate)
    return contexts


def docker_ps_names(all_containers: bool) -> list[str]:
    cmd = docker_command(["ps"])
    if all_containers:
        cmd.append("-a")
    cmd.extend(["--format", "{{.Names}}"])
    result = _run(cmd, timeout=10)
    if not result.success:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def colima_status() -> dict[str, Any]:
    result = _run(["colima", "status", "--json"], timeout=20)
    if not result.success or not result.stdout:
        return {"running": False, "ip_address": None}
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"running": False, "ip_address": None}
    return {
        "running": data.get("status") == "Running",
        "ip_address": data.get("ip_address"),
        "raw": data,
    }


def build_colima_start_command(colima_cfg: dict[str, Any]) -> list[str]:
    cmd = ["colima", "start", "--network-address"]
    if vm_arch := colima_cfg.get("vm_arch"):
        cmd.extend(["--arch", str(vm_arch)])
    if vm_type := colima_cfg.get("vm_type"):
        cmd.extend(["--vm-type", str(vm_type)])
        if vm_type == "vz" and colima_cfg.get("vz_rosetta", False):
            cmd.append("--vz-rosetta")
    if cpu := colima_cfg.get("cpu"):
        cmd.extend(["--cpu", str(cpu)])
    if memory := colima_cfg.get("memory"):
        cmd.extend(["--memory", str(memory)])
    if disk := colima_cfg.get("disk"):
        cmd.extend(["--disk", str(disk)])
    return cmd


def cloudflared_version(binary: Path | str | None = None) -> str | None:
    target = str(binary) if binary is not None else (shutil.which("cloudflared") or "")
    if not target:
        return None
    result = _run([target, "--version"], timeout=10)
    if not result.success:
        return None
    match = re.search(r"version\s+([0-9.]+)", result.stdout)
    return match.group(1) if match else None


def brew_available() -> bool:
    return shutil.which("brew") is not None


def is_brew_formula_installed(formula: str) -> bool:
    if not brew_available():
        return False
    result = _run(["brew", "list", "--formula", formula], timeout=20)
    return result.success


def is_brew_pinned(formula: str) -> bool:
    if not brew_available():
        return False
    result = _run(["brew", "list", "--pinned"], timeout=20)
    return result.success and formula in {line.strip() for line in result.stdout.splitlines()}


def render_launch_agent(settings: DNSSettings, cloudflared_bin: Path) -> str:
    template = Template(LAUNCH_AGENT_TEMPLATE.read_text())
    return template.render(
        CLOUDFLARED_BIN=str(cloudflared_bin),
        LOG_PATH=str(LAUNCH_AGENT_LOG),
        LISTEN_ADDRESS=settings.cloudflared_address,
        LISTEN_PORT=settings.cloudflared_port,
        UPSTREAMS=list(settings.cloudflared_upstreams),
    )


def cloudflared_release_asset_name() -> str | None:
    if platform.system() != "Darwin":
        return None

    machine = platform.machine().lower()
    if machine in {"arm64", "aarch64"}:
        return "cloudflared-darwin-arm64.tgz"
    if machine in {"x86_64", "amd64"}:
        return "cloudflared-darwin-amd64.tgz"
    return None


def cloudflared_release_url(settings: DNSSettings) -> str | None:
    asset = cloudflared_release_asset_name()
    if asset is None:
        return None
    return (
        f"{settings.cloudflared_release_base_url}/"
        f"{settings.cloudflared_required_version}/{asset}"
    )


def cloudflared_release_metadata_api_url(settings: DNSSettings) -> str:
    return (
        f"{settings.cloudflared_release_metadata_url}/" f"{settings.cloudflared_required_version}"
    )


def ensure_bootstrap_symlink(link_path: Path, target_path: Path, dry_run: bool = False) -> bool:
    desired_target = target_path.name
    if link_path.is_symlink() and str(link_path.readlink()) == desired_target:
        return False
    if not dry_run:
        link_path.parent.mkdir(parents=True, exist_ok=True)
        if link_path.exists() or link_path.is_symlink():
            if link_path.is_dir() and not link_path.is_symlink():
                raise RuntimeError(f"Refusing to replace directory at {link_path}.")
            link_path.unlink()
        link_path.symlink_to(desired_target)
    return True


def bootstrap_cloudflared_binary(
    settings: DNSSettings,
    versioned_target: Path,
    stable_target: Path,
) -> dict[str, Any]:
    evidence: dict[str, Any] = {
        "success": False,
        "required_version": settings.cloudflared_required_version,
        "release_url": cloudflared_release_url(settings),
        "versioned_target": str(versioned_target),
        "stable_target": str(stable_target),
    }
    asset_name = cloudflared_release_asset_name()
    if asset_name is None or evidence["release_url"] is None:
        unsupported_platform = (
            "Unsupported platform for cloudflared bootstrap: "
            f"system={platform.system()} arch={platform.machine()}"
        )
        evidence["error"] = unsupported_platform
        return evidence

    cache_dir = settings.cloudflared_bootstrap_cache_dir / settings.cloudflared_required_version
    archive_path = cache_dir / asset_name
    evidence["archive_path"] = str(archive_path)
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        verification = ensure_verified_cloudflared_archive(
            settings,
            cache_dir,
            archive_path,
            asset_name,
        )
        evidence["verification"] = verification
        if not verification.get("success"):
            evidence["error"] = verification.get(
                "error", "cloudflared archive verification failed."
            )
            return evidence

        versioned_target.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive_path, "r:gz") as archive:
            member = next(
                (
                    candidate
                    for candidate in archive.getmembers()
                    if candidate.isfile() and Path(candidate.name).name == "cloudflared"
                ),
                None,
            )
            if member is None:
                evidence["error"] = f"{archive_path} did not contain a cloudflared binary."
                return evidence
            extracted = archive.extractfile(member)
            if extracted is None:
                evidence["error"] = f"Could not extract cloudflared from {archive_path}."
                return evidence
            with tempfile.NamedTemporaryFile(
                dir=versioned_target.parent,
                delete=False,
            ) as tmp_binary:
                shutil.copyfileobj(extracted, tmp_binary)
                temp_binary = Path(tmp_binary.name)

        temp_binary.chmod(0o755)
        temp_binary.replace(versioned_target)
        ensure_bootstrap_symlink(stable_target, versioned_target)

        observed_version = cloudflared_version(stable_target)
        evidence["observed_version"] = observed_version
        if observed_version != settings.cloudflared_required_version:
            evidence["error"] = (
                f"Bootstrapped cloudflared version mismatch: expected {settings.cloudflared_required_version}, "
                f"observed {observed_version or 'unknown'}."
            )
            return evidence
    except (HTTPError, URLError, OSError, tarfile.TarError, RuntimeError) as exc:
        evidence["error"] = f"{type(exc).__name__}: {exc}"
        return evidence

    evidence["success"] = True
    return evidence


def ensure_verified_cloudflared_archive(
    settings: DNSSettings,
    cache_dir: Path,
    archive_path: Path,
    asset_name: str,
) -> dict[str, Any]:
    evidence: dict[str, Any] = {
        "success": False,
        "asset_name": asset_name,
        "archive_path": str(archive_path),
    }
    checksum = resolve_cloudflared_expected_sha256(settings, asset_name, cache_dir)
    evidence["checksum"] = checksum
    if not checksum.get("success"):
        evidence["error"] = checksum.get("error", "Failed to resolve cloudflared archive checksum.")
        return evidence

    expected_sha256 = checksum["expected_sha256"]
    evidence["expected_sha256"] = expected_sha256

    if archive_path.exists():
        cached_sha256 = sha256_file(archive_path)
        evidence["cached_archive_sha256"] = cached_sha256
        if cached_sha256 == expected_sha256:
            evidence["used_cached_archive"] = True
            evidence["success"] = True
            return evidence
        archive_path.unlink(missing_ok=True)
        evidence["cache_mismatch"] = True

    request = Request(
        str(cloudflared_release_url(settings)),
        headers={"User-Agent": "NextLevelApex/1.0"},
    )
    try:
        with (
            urlopen(request, timeout=60) as response,
            tempfile.NamedTemporaryFile(dir=cache_dir, delete=False) as tmp,
        ):
            shutil.copyfileobj(response, tmp)
            temp_archive = Path(tmp.name)
        temp_archive.replace(archive_path)
        downloaded_sha256 = sha256_file(archive_path)
        evidence["downloaded_archive_sha256"] = downloaded_sha256
        if downloaded_sha256 != expected_sha256:
            archive_path.unlink(missing_ok=True)
            evidence["error"] = (
                f"cloudflared archive checksum mismatch: expected {expected_sha256}, "
                f"observed {downloaded_sha256}."
            )
            return evidence
    except (HTTPError, URLError, OSError) as exc:
        evidence["error"] = f"{type(exc).__name__}: {exc}"
        return evidence

    evidence["success"] = True
    return evidence


def resolve_cloudflared_expected_sha256(
    settings: DNSSettings,
    asset_name: str,
    cache_dir: Path,
) -> dict[str, Any]:
    metadata = load_cloudflared_release_metadata(settings, cache_dir)
    evidence: dict[str, Any] = {
        "success": False,
        "asset_name": asset_name,
        "metadata": {key: value for key, value in metadata.items() if key != "payload"},
    }
    if not metadata.get("success"):
        evidence["error"] = metadata.get("error", "cloudflared release metadata unavailable.")
        return evidence

    payload = metadata.get("payload") or {}
    asset = next(
        (
            candidate
            for candidate in payload.get("assets", [])
            if candidate.get("name") == asset_name
        ),
        None,
    )
    if asset is None:
        evidence["error"] = f"Release metadata did not include asset {asset_name}."
        return evidence

    digest = asset.get("digest")
    if isinstance(digest, str) and digest.startswith("sha256:"):
        evidence["expected_sha256"] = digest.split(":", 1)[1].lower()
        evidence["source"] = "asset.digest"
        evidence["success"] = True
        return evidence

    checksums = parse_cloudflared_release_checksums(str(payload.get("body", "")))
    expected_sha256 = checksums.get(asset_name)
    if expected_sha256 is None:
        evidence["error"] = f"Release metadata did not contain a SHA256 checksum for {asset_name}."
        return evidence

    evidence["expected_sha256"] = expected_sha256
    evidence["source"] = "release.body"
    evidence["success"] = True
    return evidence


def load_cloudflared_release_metadata(
    settings: DNSSettings,
    cache_dir: Path,
) -> dict[str, Any]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = cache_dir / "release-metadata.json"
    evidence: dict[str, Any] = {
        "success": False,
        "release_api_url": cloudflared_release_metadata_api_url(settings),
        "metadata_path": str(metadata_path),
    }

    if metadata_path.exists():
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            evidence["cache_error"] = f"{type(exc).__name__}: {exc}"
        else:
            if payload.get("tag_name") == settings.cloudflared_required_version:
                evidence["source"] = "cache"
                evidence["success"] = True
                evidence["payload"] = payload
                return evidence

    request = Request(
        evidence["release_api_url"],
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "NextLevelApex/1.0",
        },
    )
    try:
        with (
            urlopen(request, timeout=30) as response,
            tempfile.NamedTemporaryFile(dir=cache_dir, delete=False) as tmp,
        ):
            payload = json.load(response)
            tmp.write(json.dumps(payload, indent=2, sort_keys=True).encode("utf-8"))
            temp_metadata = Path(tmp.name)
        temp_metadata.replace(metadata_path)
    except (HTTPError, URLError, OSError, json.JSONDecodeError) as exc:
        evidence["error"] = f"{type(exc).__name__}: {exc}"
        return evidence

    if payload.get("tag_name") != settings.cloudflared_required_version:
        evidence["error"] = (
            f"Release metadata tag mismatch: expected {settings.cloudflared_required_version}, "
            f"observed {payload.get('tag_name') or 'unknown'}."
        )
        return evidence

    evidence["source"] = "network"
    evidence["success"] = True
    evidence["payload"] = payload
    return evidence


def parse_cloudflared_release_checksums(body: str) -> dict[str, str]:
    checksums: dict[str, str] = {}
    for line in body.splitlines():
        match = re.match(r"^([A-Za-z0-9._-]+):\s*([0-9a-fA-F]{64})$", line.strip())
        if match:
            checksums[match.group(1)] = match.group(2).lower()
    return checksums


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def launch_agent_running() -> bool:
    result = _run(
        ["launchctl", "print", f"gui/{os.getuid()}/{LAUNCH_AGENT_LABEL}"],
        timeout=10,
    )
    return result.success and "state = running" in result.stdout


def reload_launch_agent() -> dict[str, Any]:
    unload = _run(
        ["launchctl", "bootout", f"gui/{os.getuid()}", str(LAUNCH_AGENT_PATH)],
        timeout=15,
    )
    load = _run(
        ["launchctl", "bootstrap", f"gui/{os.getuid()}", str(LAUNCH_AGENT_PATH)],
        timeout=15,
    )
    return {
        "success": load.success,
        "unload": _serialize_command(unload),
        "load": _serialize_command(load),
    }


def cloudflared_listener_healthy(settings: DNSSettings) -> bool:
    dig_ok = _run(
        [
            "dig",
            f"@{settings.cloudflared_address}",
            "-p",
            str(settings.cloudflared_port),
            "example.com",
            "+short",
        ],
        timeout=15,
    )
    dnssec = _run(
        [
            "dig",
            f"@{settings.cloudflared_address}",
            "-p",
            str(settings.cloudflared_port),
            "dnssec-failed.org",
            "+dnssec",
        ],
        timeout=15,
    )
    return dig_ok.success and bool(dig_ok.stdout.strip()) and "SERVFAIL" in dnssec.stdout


def wait_for_cloudflared_health(settings: DNSSettings, timeout_seconds: int = 10) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if cloudflared_listener_healthy(settings):
            return True
        time.sleep(0.5)
    return False


def remove_legacy_containers(
    dry_run: bool = False,
    container_names: tuple[str, ...] = LEGACY_CONTAINERS,
) -> StepResult:
    messages: list[tuple[Severity, str]] = []
    evidence: dict[str, Any] = {"contexts": []}
    changed = False
    for context in legacy_container_contexts():
        list_cmd = docker_command(["ps", "-a", "--format", "{{.Names}}"], context=context)
        listing = _run(list_cmd, timeout=10)
        context_evidence: dict[str, Any] = {
            "context": context,
            "list": _serialize_command(listing),
        }
        evidence["contexts"].append(context_evidence)
        if not listing.success:
            continue

        names = {line.strip() for line in listing.stdout.splitlines() if line.strip()}
        context_evidence["visible_containers"] = sorted(names)
        for name in container_names:
            if name not in names:
                continue
            if dry_run:
                messages.append(
                    (
                        Severity.INFO,
                        f"Would remove legacy container {name} from Docker context {context}.",
                    )
                )
                changed = True
                continue
            remove = _run(docker_command(["rm", "-f", name], context=context), timeout=60)
            context_evidence[name] = _serialize_command(remove)
            if not remove.success:
                messages.append(
                    (
                        Severity.ERROR,
                        f"Failed to remove legacy container {name} from Docker context {context}.",
                    )
                )
                return StepResult(False, changed, messages, evidence)
            changed = True
            messages.append(
                (Severity.INFO, f"Removed legacy container {name} from Docker context {context}.")
            )
    return StepResult(True, changed, messages, evidence)


def canonical_resolver_health(settings: DNSSettings) -> dict[str, Any]:
    udp = _run(["dig", f"@{settings.resolver_ip}", "example.com", "+short"], timeout=15)
    tcp = _run(["dig", "+tcp", f"@{settings.resolver_ip}", "example.com", "+short"], timeout=15)
    return {
        "success": udp.success
        and bool(udp.stdout.strip())
        and tcp.success
        and bool(tcp.stdout.strip()),
        "udp": _serialize_command(udp),
        "tcp": _serialize_command(tcp),
    }


def validate_temporary_dns_recovery() -> dict[str, Any]:
    default_query = _run(["dig", "example.com", "+short"], timeout=15)
    default_server = _run(["dig", "example.com"], timeout=15)
    connectivity = _run(["curl", "-sI", "https://example.com"], timeout=20)
    return {
        "success": default_query.success
        and bool(default_query.stdout.strip())
        and connectivity.success
        and "HTTP/" in connectivity.stdout,
        "default_query": _serialize_command(default_query),
        "default_server": _serialize_command(default_server),
        "connectivity": _serialize_command(connectivity),
    }


def audit_noncanonical_dns_artifacts(home: Path | None = None) -> dict[str, Any]:
    backup_path = (
        LAUNCH_AGENT_BACKUP_PATH
        if home is None
        else home / "Library" / "LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist.bak"
    )
    unbound_binary = shutil.which("unbound")
    unbound_formula_installed = is_brew_formula_installed("unbound")
    return {
        "success": not bool(unbound_binary or unbound_formula_installed or backup_path.exists()),
        "unbound": {
            "binary_path": unbound_binary,
            "formula_installed": unbound_formula_installed,
        },
        "launchagent_backup": {
            "path": str(backup_path),
            "exists": backup_path.exists(),
        },
    }


def append_noncanonical_dns_artifact_messages(
    messages: list[tuple[Severity, str]],
    audit: dict[str, Any],
) -> bool:
    success = True
    unbound = audit.get("unbound", {})
    if unbound.get("binary_path") or unbound.get("formula_installed"):
        success = False
        detail = unbound.get("binary_path") or "Homebrew formula"
        messages.append(
            (
                Severity.ERROR,
                f"Non-canonical drift: local Unbound remains installed ({detail}) even though the authoritative single-device DNS path does not use Unbound.",
            )
        )

    backup = audit.get("launchagent_backup", {})
    if backup.get("exists"):
        success = False
        messages.append(
            (
                Severity.ERROR,
                f"Non-authoritative drift: stale cloudflared LaunchAgent backup artifact remains at {backup.get('path')}.",
            )
        )

    if success:
        messages.append(
            (
                Severity.INFO,
                "No non-canonical local Unbound or backup LaunchAgent artifacts were detected.",
            )
        )
    return success


def audit_browser_dns_posture(home: Path | None = None) -> dict[str, Any]:
    base_home = home or Path.home()
    targets: list[dict[str, Any]] = []
    explicit_dns_overrides: list[dict[str, Any]] = []
    parse_errors: list[dict[str, Any]] = []
    audited_browsers: list[str] = []

    for browser, parts in CHROMIUM_BROWSER_SUPPORT_DIRS:
        target = inspect_chromium_browser_dns_posture(browser, base_home.joinpath(*parts))
        targets.append(target)
        if target["audited"]:
            audited_browsers.append(browser)
        explicit_dns_overrides.extend(target["explicit_dns_overrides"])
        parse_errors.extend(target["parse_errors"])

    firefox = inspect_firefox_browser_dns_posture(base_home.joinpath(*FIREFOX_PROFILE_DIR))
    targets.append(firefox)
    if firefox["audited"]:
        audited_browsers.append("Firefox")
    explicit_dns_overrides.extend(firefox["explicit_dns_overrides"])
    parse_errors.extend(firefox["parse_errors"])

    return {
        "success": not explicit_dns_overrides and not parse_errors,
        "audited_browsers": audited_browsers,
        "targets": targets,
        "explicit_dns_overrides": explicit_dns_overrides,
        "parse_errors": parse_errors,
    }


def inspect_chromium_browser_dns_posture(browser: str, root: Path) -> dict[str, Any]:
    target: dict[str, Any] = {
        "browser": browser,
        "kind": "chromium",
        "root": str(root),
        "audited": False,
        "profiles": [],
        "explicit_dns_overrides": [],
        "parse_errors": [],
    }
    if not root.exists():
        return target

    for profile_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        preference_files = [
            profile_dir / "Preferences",
            profile_dir / "Secure Preferences",
        ]
        for pref_path in preference_files:
            if not pref_path.exists():
                continue
            target["audited"] = True
            profile_evidence: dict[str, Any] = {
                "profile": profile_dir.name,
                "file": str(pref_path),
            }
            try:
                payload = json.loads(pref_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                profile_evidence["error"] = f"{type(exc).__name__}: {exc}"
                target["parse_errors"].append(profile_evidence)
                target["profiles"].append(profile_evidence)
                continue

            findings: dict[str, Any] = {}
            dns_over_https = payload.get("dns_over_https")
            if dns_over_https not in (None, {}, ""):
                findings["dns_over_https"] = dns_over_https
            built_in_dns_client = payload.get("built_in_dns_client")
            if built_in_dns_client not in (None, {}, ""):
                findings["built_in_dns_client"] = built_in_dns_client

            if findings:
                override = {
                    "browser": browser,
                    "profile": profile_dir.name,
                    "file": str(pref_path),
                    "findings": findings,
                }
                profile_evidence["explicit_dns_override"] = True
                profile_evidence["findings"] = findings
                target["explicit_dns_overrides"].append(override)
            else:
                profile_evidence["explicit_dns_override"] = False

            target["profiles"].append(profile_evidence)

    return target


def inspect_firefox_browser_dns_posture(root: Path) -> dict[str, Any]:
    target: dict[str, Any] = {
        "browser": "Firefox",
        "kind": "firefox",
        "root": str(root),
        "audited": False,
        "profiles": [],
        "explicit_dns_overrides": [],
        "parse_errors": [],
    }
    if not root.exists():
        return target

    for profile_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        preference_files = [profile_dir / "prefs.js", profile_dir / "user.js"]
        for pref_path in preference_files:
            if not pref_path.exists():
                continue
            target["audited"] = True
            profile_evidence: dict[str, Any] = {
                "profile": profile_dir.name,
                "file": str(pref_path),
            }
            try:
                contents = pref_path.read_text(encoding="utf-8", errors="ignore")
            except OSError as exc:
                profile_evidence["error"] = f"{type(exc).__name__}: {exc}"
                target["parse_errors"].append(profile_evidence)
                target["profiles"].append(profile_evidence)
                continue

            findings: dict[str, str] = {}
            for line in contents.splitlines():
                match = re.match(r'^user_pref\("([^"]+)",\s*(.+)\);$', line.strip())
                if not match:
                    continue
                key, value = match.groups()
                if key.startswith("network.trr."):
                    findings[key] = value

            if findings:
                override = {
                    "browser": "Firefox",
                    "profile": profile_dir.name,
                    "file": str(pref_path),
                    "findings": findings,
                }
                profile_evidence["explicit_dns_override"] = True
                profile_evidence["findings"] = findings
                target["explicit_dns_overrides"].append(override)
            else:
                profile_evidence["explicit_dns_override"] = False

            target["profiles"].append(profile_evidence)

    return target


def append_browser_dns_posture_messages(
    messages: list[tuple[Severity, str]],
    audit: dict[str, Any],
) -> bool:
    success = True
    if audit.get("parse_errors"):
        success = False
        locations = ", ".join(
            f"{item.get('browser')}:{item.get('file')}" for item in audit["parse_errors"]
        )
        messages.append(
            (
                Severity.ERROR,
                f"Browser/app DNS posture audit could not parse one or more local preference files: {locations}.",
            )
        )

    if audit.get("explicit_dns_overrides"):
        success = False
        details = "; ".join(
            (
                f"{item.get('browser')} {item.get('profile')} "
                f"({Path(item.get('file', '')).name}) -> {', '.join(sorted(item.get('findings', {}).keys()))}"
            )
            for item in audit["explicit_dns_overrides"]
        )
        messages.append(
            (
                Severity.ERROR,
                f"Browser/app DNS posture drift: explicit DNS override settings were found in local browser profiles: {details}.",
            )
        )

    if success:
        audited = audit.get("audited_browsers", [])
        if audited:
            messages.append(
                (
                    Severity.INFO,
                    "Browser/app DNS posture audit found no explicit DNS override settings in: "
                    + ", ".join(audited)
                    + ".",
                )
            )
        else:
            messages.append(
                (
                    Severity.INFO,
                    "Browser/app DNS posture audit found no supported local browser profile stores to inspect.",
                )
            )
    return success


def resolve_pihole_password(settings: DNSSettings) -> tuple[str, bool]:
    env_password = os.environ.get(settings.password_env_var, "").strip()
    if env_password:
        return env_password, False

    if PASSWORD_PATH.exists():
        stored = PASSWORD_PATH.read_text().strip()
        if stored:
            return stored, False

    configured = settings.default_web_password.strip()
    if configured and configured not in {"CHANGE_THIS_PASSWORD_NOW", "changeme"}:
        return configured, False

    password = secrets.token_urlsafe(24)
    PASSWORD_PATH.parent.mkdir(parents=True, exist_ok=True)
    PASSWORD_PATH.write_text(password)
    PASSWORD_PATH.chmod(0o600)
    return password, True


def wait_for_pihole_health(timeout_seconds: int = 60) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        inspect = inspect_container(PIHOLE_CONTAINER)
        if inspect:
            state = inspect.get("State") or {}
            if state.get("Running") and ((state.get("Health") or {}).get("Status") == "healthy"):
                return True
        time.sleep(2)
    return False


def get_pihole_upstreams() -> set[str]:
    result = _run(
        ["docker", "exec", PIHOLE_CONTAINER, "pihole-FTL", "--config", "dns.upstreams"],
        timeout=15,
    )
    if not result.success:
        return set()
    tokens = set(re.findall(r"[A-Za-z0-9_.:-]+(?:#[0-9]+)?", result.stdout))
    return {token for token in tokens if token}


def set_pihole_upstream(upstream: str) -> dict[str, Any]:
    result = _run(
        [
            "docker",
            "exec",
            PIHOLE_CONTAINER,
            "bash",
            "-lc",
            f'. /usr/bin/bash_functions.sh; setFTLConfigValue dns.upstreams "[\\"{upstream}\\"]"',
        ],
        timeout=30,
    )
    return {"success": result.success, "command": _serialize_command(result)}


def validate_pihole_endpoints(settings: DNSSettings) -> dict[str, Any]:
    udp = _run(["dig", f"@{settings.resolver_ip}", "example.com", "+short"], timeout=15)
    tcp = _run(
        ["dig", "+tcp", f"@{settings.resolver_ip}", "example.com", "+short"],
        timeout=15,
    )
    admin = _run(
        ["curl", "-I", "-s", f"http://{settings.resolver_ip}:{settings.pihole_web_port}/admin/"],
        timeout=15,
    )
    return {
        "success": udp.success
        and bool(udp.stdout.strip())
        and tcp.success
        and bool(tcp.stdout.strip())
        and "302" in admin.stdout,
        "udp": _serialize_command(udp),
        "tcp": _serialize_command(tcp),
        "admin": _serialize_command(admin),
    }


def inspect_container(name: str) -> dict[str, Any] | None:
    result = _run(docker_command(["inspect", name]), timeout=20)
    if not result.success or not result.stdout:
        return None
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return payload[0] if payload else None


def _has_binding(
    bindings: dict[str, Any],
    port_key: str,
    host_ip: str,
    host_port: str,
) -> bool:
    entries = bindings.get(port_key) or []
    for entry in entries:
        if entry.get("HostIp") == host_ip and entry.get("HostPort") == host_port:
            return True
    return False


def _run(cmd: list[str], timeout: int) -> CommandOutcome:
    try:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return CommandOutcome(cmd=cmd, returncode=-1, stdout="", stderr=str(exc))

    return CommandOutcome(
        cmd=cmd,
        returncode=completed.returncode,
        stdout=(completed.stdout or "").strip(),
        stderr=(completed.stderr or "").strip(),
    )


def _serialize_command(result: CommandOutcome) -> dict[str, Any]:
    return {
        "cmd": result.cmd,
        "returncode": result.returncode,
        "success": result.success,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }
