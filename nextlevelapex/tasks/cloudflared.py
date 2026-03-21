from __future__ import annotations

from nextlevelapex.core.registry import task
from nextlevelapex.core.task import TaskContext, TaskResult
from nextlevelapex.tasks.dns_stack_runtime import ensure_cloudflared_service, load_dns_settings


@task("Cloudflared DoH")
def setup_cloudflared(context: TaskContext) -> TaskResult:
    settings, messages = load_dns_settings(context["config"])
    result = ensure_cloudflared_service(settings, dry_run=context["dry_run"])
    return TaskResult(
        name="Cloudflared DoH",
        success=result.success,
        changed=result.changed,
        messages=messages + result.messages,
        details=result.evidence,
    )
