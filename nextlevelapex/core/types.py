from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Union


@dataclass
class ColimaStatusResult:
    success: bool
    reason: str
    matched_indicators: List[str] = field(default_factory=list)
    raw_stdout: Optional[str] = None
    raw_stderr: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = field(default_factory=dict)


@dataclass
class ServiceCheckResult:
    service_name: str
    is_running: bool
    status_output: Optional[str] = None
    extra_info: Optional[Dict[str, Union[str, bool, int]]] = field(default_factory=dict)
    reason: Optional[str] = None


@dataclass
class InstallableToolStatus:
    name: str
    is_installed: bool
    version: Optional[str] = None
    source: Literal["brew", "cask", "manual", "mise", "unknown"] = "unknown"
    install_path: Optional[str] = None
    notes: Optional[str] = None


@dataclass
class CommandDiagnostic:
    command: str
    returncode: int
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    success: bool = False
    timestamp: Optional[str] = None
    runtime_seconds: Optional[float] = None


@dataclass
class VerificationOutcome:
    passed: bool
    failure_reason: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    info: Optional[str] = None


@dataclass
class SectionHealthSummary:
    section_name: str
    success: bool
    failed_tasks: List[str] = field(default_factory=list)
    notes: Optional[str] = None


@dataclass
class DependencyState:
    name: str
    expected_version: Optional[str]
    actual_version: Optional[str]
    is_satisfied: bool
    source: Literal["brew", "mise", "env", "system", "unknown"] = "unknown"


@dataclass
class SecurityModuleStatus:
    module: str
    enabled: bool
    verification_command: Optional[str] = None
    output: Optional[str] = None
    notes: Optional[str] = None
