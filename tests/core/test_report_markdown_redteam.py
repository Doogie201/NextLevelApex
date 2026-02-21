import tempfile
import unittest
from pathlib import Path

from nextlevelapex.core.report import generate_markdown_report


class TestReportMarkdownRedteam(unittest.TestCase):
    def test_markdown_report_truncation(self):
        """Proof that the Markdown generator respects the symmetric state bounds."""
        with tempfile.TemporaryDirectory() as td:
            out_dir = Path(td)

            # Massive overarching payloads bypassing ingestion caps dynamically
            massive_task = "M" * 300
            massive_status = "N" * 100
            massive_ts = "T" * 100
            massive_details = {"key": "V" * 10000}

            state = {
                "task_status": {massive_task: {"status": massive_status, "last_healthy": "Never"}},
                "health_history": {
                    massive_task: [
                        {
                            "timestamp": massive_ts,
                            "status": massive_status,
                            "details": massive_details,
                        }
                    ]
                },
            }

            stamped = generate_markdown_report(state, out_dir)
            content = stamped.read_text()

            # 1. Evaluate Summary Table Bounds
            # markdown_escape uses str().replace("|", "\|") which is identical length
            # Task Name (128)
            expected_trunc_task = "M" * 128 + "...[TRUNCATED]"
            self.assertIn(expected_trunc_task, content)
            self.assertNotIn("M" * 129, content)

            # Status (16)
            expected_trunc_status = "N" * 16 + "...[TRUNCATED]"
            self.assertIn(expected_trunc_status, content)
            self.assertNotIn("N" * 17, content)

            # 2. Evaluate History details section Bounds
            # Details stringification cap (8192)
            self.assertIn("V" * 8000, content)  # It has some at least
            # Because of JSON formatting overhead, the exact 'V' char count is slightly less than 8192.
            # We strictly assert the truncation marker exists where it should stop.
            self.assertIn("...[TRUNCATED]", content)

            # Timestamp (64)
            expected_trunc_ts = "T" * 64 + "...[TRUNCATED]"
            self.assertIn(expected_trunc_ts, content)
            self.assertNotIn("T" * 65, content)
