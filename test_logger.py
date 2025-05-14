# test_logger.py
import json
import logging
from pathlib import Path

from nextlevelapex.core.logger import setup_logging

# Simulate a config dictionary similar to what's used in your CLI
mock_config = {
    "script_behavior": {
        "log_level_default": "INFO",
        "log_to_file": True,
        "log_file_directory": "~/Library/Logs/NextLevelApex",
        "log_format": "%(asctime)s [%(levelname)-8s] %(name)-22s: %(message)s",
        "date_format": "%Y-%m-%d %H:%M:%S",
    }
}

# Import your logger setup function


# Step 1: Set up logging
setup_logging(mock_config, verbose=False)

# Step 2: Create a test log entry
log = logging.getLogger("test_logger")
log.debug("This is a DEBUG message")  # Won’t show unless verbose=True
log.info("This is an INFO message")
log.warning("This is a WARNING message")
log.error("This is an ERROR message")
log.critical("This is a CRITICAL message")

# Step 3: Confirm file creation
log_dir = Path(mock_config["script_behavior"]["log_file_directory"]).expanduser()
log_files = sorted(log_dir.glob("nextlevelapex-run-*.log"), reverse=True)

if log_files:
    print(f"\nLatest log file: {log_files[0]}")
    print("Contents preview:")
    print("-" * 60)
    with open(log_files[0], "r") as f:
        print("".join(f.readlines()[-10:]))  # Show last 10 lines of the log
    print("-" * 60)
else:
    print("No log file found. Something may be wrong.")
