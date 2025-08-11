from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class ColimaStatusResult:
    success: bool
    reason: str
    matched_indicators: list[str] = field(default_factory=list)
    raw_stdout: str | None = None
    raw_stderr: str | None = None
    metadata: dict[str, Any] | None = field(default_factory=dict)


@dataclass
class ServiceCheckResult:
    service_name: str
    is_running: bool
    status_output: str | None = None
    extra_info: dict[str, str | bool | int] | None = field(default_factory=dict)
    reason: str | None = None


@dataclass
class InstallableToolStatus:
    name: str
    is_installed: bool
    version: str | None = None
    source: Literal["brew", "cask", "manual", "mise", "unknown"] = "unknown"
    install_path: str | None = None
    notes: str | None = None


@dataclass
class CommandDiagnostic:
    command: str
    returncode: int
    stdout: str | None = None
    stderr: str | None = None
    success: bool = False
    timestamp: str | None = None
    runtime_seconds: float | None = None


@dataclass
class VerificationOutcome:
    passed: bool
    failure_reason: str | None = None
    warnings: list[str] = field(default_factory=list)
    info: str | None = None


@dataclass
class SectionHealthSummary:
    section_name: str
    success: bool
    failed_tasks: list[str] = field(default_factory=list)
    notes: str | None = None


@dataclass
class DependencyState:
    name: str
    expected_version: str | None
    actual_version: str | None
    is_satisfied: bool
    source: Literal["brew", "mise", "env", "system", "unknown"] = "unknown"


@dataclass
class SecurityModuleStatus:
    module: str
    enabled: bool
    verification_command: str | None = None
    output: str | None = None
    notes: str | None = None
