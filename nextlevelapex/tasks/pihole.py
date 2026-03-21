from __future__ import annotations

from nextlevelapex.core.registry import task
from nextlevelapex.core.task import TaskContext, TaskResult
from nextlevelapex.tasks.dns_stack_runtime import (
    ensure_colima_runtime,
    ensure_docker_context_colima,
    ensure_pihole_container,
    load_dns_settings,
)


@task("Pi-hole DNS Sinkhole")
def setup_pihole(context: TaskContext) -> TaskResult:
    settings, messages = load_dns_settings(context["config"])
    changed = False
    details: dict[str, object] = {}

    colima = ensure_colima_runtime(context["config"], settings, dry_run=context["dry_run"])
    messages.extend(colima.messages)
    changed |= colima.changed
    details["colima"] = colima.evidence
    if not colima.success:
        return TaskResult("Pi-hole DNS Sinkhole", False, changed, messages, details)

    docker_context = ensure_docker_context_colima(dry_run=context["dry_run"])
    messages.extend(docker_context.messages)
    changed |= docker_context.changed
    details["docker_context"] = docker_context.evidence
    if not docker_context.success:
        return TaskResult("Pi-hole DNS Sinkhole", False, changed, messages, details)

    pihole = ensure_pihole_container(settings, dry_run=context["dry_run"])
    messages.extend(pihole.messages)
    changed |= pihole.changed
    details["pihole"] = pihole.evidence
    return TaskResult(
        name="Pi-hole DNS Sinkhole",
        success=pihole.success,
        changed=changed,
        messages=messages,
        details=details,
    )
