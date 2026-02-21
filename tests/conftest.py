import pytest

from nextlevelapex.main2 import discover_tasks


@pytest.fixture(autouse=True)
def preload_task_registry():
    """Ensure all tasks are loaded into the registry before tests run,
    so tests that assert against the registry directly don't fail due to
    lazy module loading after the sys.path removal."""
    discover_tasks()
