from nextlevelapex.core.task import TaskResult
from nextlevelapex.tasks.security import security_task


def test_security_smoke():
    res: TaskResult = security_task({"config": {"security": {}}, "dry_run": True, "verbose": False})
    assert res.success
