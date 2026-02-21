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

## [2026-02-20] Phase 2: Registry & Import Hardening

### Addressed Issues
- **Issue B (High): Task Module Provenance & Foreign Code Injection:** Identified that the `@task` decorator (`registry.py`) was blindly accepting tasks from any module path. We added a strict `__module__.startswith("nextlevelapex.tasks.")` whitelist enforcement. Any foreign task now halts execution with a `RuntimeError` and triggers a `CRITICAL` log event.
- **Issue F (Low/Medium): Import Hijacking / sys.path Integrity:** Identified that `nextlevelapex/main2.py` in `discover_tasks()` was dynamically executing `sys.path.insert(0, str(TASKS_DIR.parent))`. This posed a global shadowing risk. We removed the statement entirely.

### Red-Team Diff Review
- **Subprocess Paths**: None modified.
- **Dynamic Imports**: Reviewed the underlying execution path in `importlib.import_module`. By purging the `sys.path.insert(0)` hack, we forced module discovery to adhere to the rigid Poetry installation environment path, mitigating localized Python shadowing attacks.
- **File Write Paths**: None modified.
- **Templating / Rendering**: None modified.
- **Privilege Expansion**: None modified.

### Testing Evidence
- Created `tests/core/test_registry_security.py` executing targeted injection behaviors:
  - Validated that foreign scripts injecting a fake task trigger the correct rejection.
  - Validated that obfuscated structures missing a `__module__` attribute trigger the correct rejection.
- Executed `poetry run pytest` yielding **39/39 passing** validations.
- `discover_tasks` integration across the suite modified to explicitly load from the centralized CLI harness instead of assuming the global state mutation. All tests passed.
