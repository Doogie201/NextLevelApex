from __future__ import annotations

from nextlevelapex.core.registry import task
from nextlevelapex.core.task import TaskContext, TaskResult
from nextlevelapex.tasks.dns_stack_runtime import orchestrate_dns_stack

TASK_NAME = "DNS Stack Setup"


@task(TASK_NAME)
def run(ctx: TaskContext) -> TaskResult:
    result = orchestrate_dns_stack(ctx["config"], dry_run=ctx["dry_run"])
    return TaskResult(
        name=TASK_NAME,
        success=result.success,
        changed=result.changed,
        messages=result.messages,
        details=result.evidence,
    )
