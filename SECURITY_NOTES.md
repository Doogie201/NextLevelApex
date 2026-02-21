# NextLevelApex Security Notes & Audit Trail

This document tracks all AppSec remediation workflows, red-team diff reviews, and security invariant test validations applied to the `NextLevelApex` orchestrator.

## [2026-02-20] Phase 1: Drift Detection & Atomic Writes

### Addressed Issues
- **Issue A (High): Drift Detection Correctness:** Fixed an issue where stored state hashes were overwritten before comparison. Implemented `compute_file_history_hash` as a pure function and restructured `main2.py` logic to evaluate drift *prior* to mutating the `file_hashes` dictionary.
- **Issue E (Medium): Atomic File Writes:** Replaced standard `open()` calls in `save_state` with `atomic_write_json_0600`. The new helper generates a `.tmp_state_` file, writes the JSON, issues an `fsync`, enforces `0600` permissions via `Path.chmod()`, and then utilizes `Path.replace()` for an atomic swap.

### Red-Team Diff Review
- **Subprocess Paths**: No new `subprocess.run` calls were introduced.
- **Dynamic Imports**: No new dynamic imports were introduced.
- **File Write Paths**:
  - Validated that `tempfile.mkstemp` is constrained to the same parent directory to avoid cross-device linking errors during `Path.replace()`.
  - Added `O_NOFOLLOW` check during hash computation (`compute_file_history_hash`) and explicitly reject symlinks to mitigate TOCTOU symlink race attacks against `state.json` trackers.
- **Templating / Rendering**: None applicable.
- **Privilege Expansion**: None applicable.

### Testing Evidence
- Executed `poetry run pytest tests/core/test_drift_atomic.py` which yielded **100% (3/3) passing**.
  - `test_atomic_write_json_0600` ensures `0600` file permissions and flawless data recall.
  - `test_compute_hash_pure` ensures hashing logic survives read cycles without state corruption.
  - `test_drift_detection_integration` correctly triggers the mismatch check when file text mutates.
- Executed `poetry run ruff check .` yielding **zero** lint errors.
