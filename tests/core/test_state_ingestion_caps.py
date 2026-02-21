import socket
import unittest
from typing import Any

from nextlevelapex.core.state import _truncate, update_task_health


class TestStateIngestionCaps(unittest.TestCase):
    def test_truncate_helper_safe_serialization(self):
        """Proof that the pure helper traps non-serializable objects without throwing."""
        # Socket objects cannot natively serialize into JSON
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = _truncate(sock, 10)
        self.assertIn("...[TRUNCATED]", result)
        self.assertLessEqual(len(result), 10 + len("...[TRUNCATED]"))
        sock.close()

    def test_update_task_health_enforces_bounds(self):
        """Proof that pushing huge details or status strings through update_task_health are cut aggressively."""
        state: dict[str, Any] = {}

        massive_task = "T" * 5000
        massive_status = "S" * 5000
        massive_key = "K" * 5000
        massive_val = "V" * 20000

        details = {massive_key: massive_val, "normal": 123}

        # Fire
        update_task_health(massive_task, massive_status, details, state)

        # Retrieve the generated dictionary key which was truncated behind the scenes
        truncated_task_key = massive_task[:128] + "...[TRUNCATED]"

        # Verify Key Injection Cap
        self.assertIn(truncated_task_key, state["health_history"])
        self.assertNotIn(massive_task, state["health_history"])

        # Check actual pushed entry limits
        history = state["health_history"][truncated_task_key]
        self.assertEqual(len(history), 1)
        entry = history[0]

        # Status length is capped at 16
        self.assertEqual(len(entry["status"]), 16 + len("...[TRUNCATED]"))
        self.assertEqual(entry["status"], ("S" * 16) + "...[TRUNCATED]")

        # Details keys capped at 128
        truncated_detail_key = "K" * 128
        self.assertIn(truncated_detail_key, entry)

        # Details values capped at 8192
        self.assertEqual(len(entry[truncated_detail_key]), 8192 + len("...[TRUNCATED]"))

        # Normal primitive values should be casted to str and pass through unharmed
        self.assertEqual(entry["normal"], "123")
