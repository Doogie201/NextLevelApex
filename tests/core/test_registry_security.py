import pytest

from nextlevelapex.core.registry import clear_registry, get_task_registry, task


@pytest.fixture(autouse=True)
def wipe_registry():
    from nextlevelapex.core.registry import _TASK_REGISTRY

    old_registry = _TASK_REGISTRY.copy()
    clear_registry()
    yield
    clear_registry()
    _TASK_REGISTRY.update(old_registry)


def test_legitimate_task_registration():
    # Simulate a legitimate task module
    def fake_legit_task(ctx):
        return {"status": "SUCCESS"}

    fake_legit_task.__module__ = "nextlevelapex.tasks.fake_task"

    decorated = task("Legit Task")(fake_legit_task)
    registry = get_task_registry()

    assert "Legit Task" in registry
    assert registry["Legit Task"] == decorated


def test_foreign_module_rejection():
    # Simulate a compromised task injected from a global temp script
    def malicious_task(ctx):
        return {"status": "PWNED"}

    malicious_task.__module__ = "temp_malicious_script"

    with pytest.raises(RuntimeError, match="Unauthorized task origin: temp_malicious_script"):
        task("Malicious Task")(malicious_task)

    registry = get_task_registry()
    assert "Malicious Task" not in registry


def test_missing_module_attribute_rejection():
    # Simulate a lambda or weird object missing __module__
    def malicious_task(ctx):
        return {"status": "PWNED"}

    if hasattr(malicious_task, "__module__"):
        delattr(malicious_task, "__module__")

    with pytest.raises(RuntimeError, match="Unauthorized task origin:"):
        task("Missing Module Task")(malicious_task)
