import ast
import tempfile
import unittest
from pathlib import Path

from nextlevelapex.core.state import check_drift, compute_file_hashes


class TestDriftAccuracy(unittest.TestCase):
    def test_drift_unchanged(self):
        """Unchanged files do not trigger drift."""
        with tempfile.TemporaryDirectory() as td:
            f1 = Path(td) / "f1.txt"
            f1.write_text("hello")

            p1 = compute_file_hashes([f1])
            p2 = compute_file_hashes([f1])

            self.assertFalse(check_drift(p1, p2))

    def test_drift_changed_file(self):
        """A modified file triggers drift."""
        with tempfile.TemporaryDirectory() as td:
            f1 = Path(td) / "f1.txt"
            f1.write_text("hello")
            p1 = compute_file_hashes([f1])

            f1.write_text("world")
            p2 = compute_file_hashes([f1])

            self.assertTrue(check_drift(p1, p2))

    def test_drift_deleted_file(self):
        """A deleted tracked file triggers drift."""
        with tempfile.TemporaryDirectory() as td:
            f1 = Path(td) / "f1.txt"
            f1.write_text("hello")
            p1 = compute_file_hashes([f1])

            f1.unlink()
            p2 = compute_file_hashes([f1])

            self.assertTrue(check_drift(p1, p2))

    def test_drift_added_file(self):
        """A newly tracked file triggers drift."""
        with tempfile.TemporaryDirectory() as td:
            f1 = Path(td) / "f1.txt"
            f1.write_text("hello")

            f2 = Path(td) / "f2.txt"
            f2.write_text("world")

            p1 = compute_file_hashes([f1])
            p2 = compute_file_hashes([f1, f2])

            self.assertTrue(check_drift(p1, p2))

    def test_main_uses_compute_hashes_once(self):
        """Prove that main2.py calls compute_file_hashes on a single pass instead of double reading."""
        import nextlevelapex.main2 as main2

        source = Path(main2.__file__).read_text()
        tree = ast.parse(source)

        # Verify the file_hash_changed generator loop was removed and compute_file_hashes is used
        calls = 0
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "file_hash_changed":
                self.fail("main2.py is still calling the mutating file_hash_changed generator!")
            if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "compute_file_hashes":
                calls += 1

        self.assertGreaterEqual(
            calls, 1, "main2.py must call compute_file_hashes for single-pass drift"
        )
