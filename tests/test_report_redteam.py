import tempfile
import unittest
from pathlib import Path

from nextlevelapex.core.report import generate_html_report


class TestReportRedteam(unittest.TestCase):
    def test_xss_neutralization(self):
        """XSS payload in state renders harmlessly."""
        with tempfile.TemporaryDirectory() as td:
            out_dir = Path(td)
            payload = "<script>alert(1)</script>"

            state = {
                "task_status": {payload: {"status": payload, "last_healthy": payload}},
                "health_history": {
                    payload: [
                        {"timestamp": payload, "status": payload, "details": {"key": payload}}
                    ]
                },
            }

            stamped = generate_html_report(state, out_dir)
            content = stamped.read_text()

            self.assertNotIn("<script>", content)
            self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", content)

    def test_string_truncation(self):
        """Massive inputs are truncated safely."""
        with tempfile.TemporaryDirectory() as td:
            out_dir = Path(td)

            massive_task = "A" * 200
            massive_status = "B" * 50

            state = {
                "task_status": {massive_task: {"status": massive_status, "last_healthy": "Never"}}
            }

            stamped = generate_html_report(state, out_dir)
            content = stamped.read_text()

            truncated_task = "A" * 128 + "...[TRUNCATED]"
            self.assertIn(truncated_task, content)
            self.assertNotIn("A" * 129, content)

            truncated_status = "B" * 16 + "...[TRUNCATED]"
            self.assertIn(truncated_status, content)
            self.assertNotIn("B" * 17, content)
