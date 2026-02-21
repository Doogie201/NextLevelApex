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

## [2026-02-20] Phase 3: Reporting Strictness & Parameter Traversal Guard

### Addressed Issues
- **Issue C (Medium): Reporting XSS Injection:** The HTML reporting function concatenated raw JSON task details and `trend` strings directly into the DOM tree structure. Hardened `nextlevelapex/core/report.py` to recursively `html.escape()` task names, status strings, and JSON dictionary values to neutralize potentially malicious data emitted from a hijacked subsystem.
- **Issue D (Medium/Low): Schema Path Traversal & Unhandled File I/O:** The JSON Schema configuration verification was utilizing `json.loads` natively against unstructured paths. Replaced unbounded string passing with the native `importlib.resources.files` to strictly scope the load within package data bounds, mitigating DoS via path exhaustion. Added robust generic schema fallback when `json.JSONDecodeError` triggers.

### Red-Team Diff Review
- **Subprocess Paths**: None modified.
- **Dynamic Imports**: Transitioned from legacy static file strings to `importlib.resources.files()` for predictable namespace scoping.
- **File Write Paths**: None modified.
- **Templating / Rendering**: Added `html.escape()` wrapper for raw variable ingestion in report outputs.
- **Privilege Expansion**: None modified.

### Testing Evidence
- Executed XSS poison unit tests inside `tests/core/test_report_xss.py`. Demonstrated `> < script` tags and structural injections reliably convert into encoded entities (`&lt;script&gt;`).
- Resolved lingering `sys.modules` caching artifacts causing sporadic evaluation errors during Pytest's `importlib` loading loops. Verified explicitly that testing isolation correctly restores the execution engine.
- Result array executing `poetry run pytest` yielding **40/40 passing** validations.
- Result array executing `poetry run ruff check .` yielding zero lint flaws due to isolated dependency graph reloading structures.
