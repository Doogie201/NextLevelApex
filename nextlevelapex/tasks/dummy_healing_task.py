from pathlib import Path
from typing import Any

from nextlevelapex.tasks.base_task import BaseTask, RemediationPlan


class DummyHealingTask(BaseTask):
    """
    A dummy task designed to test the Advanced Meta-Level Self-Healing Protocol.
    It intentionally fails by looking for a file in /tmp that doesn't exist,
    and returns a RemediationPlan to create it via a shell command.
    """

    TASK_NAME = "DummyHealingTask"

    def run(self, context: dict[str, Any]) -> dict[str, Any]:
        # During regular runs, we just execute the health check.
        # If it fails and we are in autofix mode, main2.py will execute our plan.
        return self.health_check(context)

    def health_check(self, context: dict[str, Any]) -> dict[str, Any]:
        dummy_file = Path("/tmp/nextlevelapex_dummy_heal.txt")

        if dummy_file.exists():
            return {"status": "PASS", "details": "Dummy file exists. System is healthy."}

        # If the file is missing, we FAIL and provide the plan to fix it.
        plan: RemediationPlan = {
            "description": "Create the missing dummy file in /tmp",
            "actions": [
                {
                    "action_type": "shell_cmd",
                    "payload": "touch /tmp/nextlevelapex_dummy_heal.txt",
                    "requires_elevated": False,
                }
            ],
        }

        return {"status": "FAIL", "details": "Dummy file is missing.", "remediation_plan": plan}
