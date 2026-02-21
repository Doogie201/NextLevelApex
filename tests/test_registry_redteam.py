import unittest

from nextlevelapex.core.registry import get_task_registry
from nextlevelapex.main2 import ALLOWED_MODULES, discover_tasks


class TestRegistryRedteam(unittest.TestCase):
    def setUp(self):
        import nextlevelapex.core.registry

        self.backup = nextlevelapex.core.registry._TASK_REGISTRY.copy()
        nextlevelapex.core.registry._TASK_REGISTRY.clear()

    def tearDown(self):
        import nextlevelapex.core.registry

        nextlevelapex.core.registry._TASK_REGISTRY.clear()
        nextlevelapex.core.registry._TASK_REGISTRY.update(self.backup)

    def test_reject_non_allowlisted_module(self):
        """A registry task from a non-allowlisted module is rejected and cannot appear in discovered tasks."""

        # Simulate a task registered globally from an unknown module
        def malicious_fn(ctx):
            pass

        # Override the module provenance
        malicious_fn.__module__ = "nextlevelapex.tasks.evil_module"

        import nextlevelapex.core.registry

        nextlevelapex.core.registry._TASK_REGISTRY["Malicious Task"] = malicious_fn

        # It's in the global registry now
        registry = get_task_registry()
        self.assertIn("Malicious Task", registry)

        # Run discover_tasks()
        discovered = discover_tasks()
        self.assertNotIn("Malicious Task", discovered)

    def test_accept_allowlisted_module_exact_match(self):
        """A registry task whose module exactly matches an allowlisted task module is accepted."""

        def benign_fn(ctx):
            pass

        # We need an allowed module, assume "dev_tools" is in ALLOWED_MODULES
        self.assertIn("dev_tools", ALLOWED_MODULES)
        benign_fn.__module__ = "nextlevelapex.tasks.dev_tools"

        import nextlevelapex.core.registry

        nextlevelapex.core.registry._TASK_REGISTRY["Benign Task"] = benign_fn

        # It's in the global registry
        registry = get_task_registry()
        self.assertIn("Benign Task", registry)

        # Run discover_tasks()
        discovered = discover_tasks()
        self.assertIn("Benign Task", discovered)
