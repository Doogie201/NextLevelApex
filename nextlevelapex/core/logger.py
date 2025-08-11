# ~/Projects/NextLevelApex/nextlevelapex/core/logger.py
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

try:
    from rich.logging import RichHandler

    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False

# Default log format
DEFAULT_LOG_FORMAT = "%(asctime)s [%(levelname)-8s] %(name)-22s: %(message)s"
DEFAULT_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class LoggerProxy:
    """
    Lazy logger accessor to avoid boilerplate logger setup in each module.
    Usage: log = LoggerProxy(__name__)
    """

    def __init__(self, name: str):
        self._name = name
        self._logger: logging.Logger | None = None

    def _get_logger(self) -> logging.Logger:
        if self._logger is None:
            self._logger = logging.getLogger(self._name)
        assert self._logger is not None
        return self._logger

    def __getattr__(self, item: str) -> Any:
        return getattr(self._get_logger(), item)


def setup_logging(config: dict[str, Any], verbose: bool = False) -> None:
    """
    Sets up logging with rich console output, rotating file handler, and formatting.

    Args:
        config: The application configuration.
        verbose: Whether to enable DEBUG logging regardless of config.
    """
    script_behavior_config = config.get("script_behavior", {})

    level_str = (
        "DEBUG" if verbose else script_behavior_config.get("log_level_default", "INFO").upper()
    )
    level = getattr(logging, level_str, logging.INFO)

    log_format = script_behavior_config.get("log_format", DEFAULT_LOG_FORMAT)
    date_format = script_behavior_config.get("date_format", DEFAULT_DATE_FORMAT)

    handlers: list[logging.Handler] = []

    # Rich console handler
    if RICH_AVAILABLE:
        handlers.append(
            RichHandler(rich_tracebacks=True, markup=True, show_time=False, show_path=False)
        )
    else:
        handlers.append(logging.StreamHandler(sys.stdout))

    # File handler
    if script_behavior_config.get("log_to_file", True):
        log_dir_str = script_behavior_config.get(
            "log_file_directory", "~/Library/Logs/NextLevelApex"
        )
        log_dir = Path(log_dir_str).expanduser().resolve()
        try:
            log_dir.mkdir(parents=True, exist_ok=True)
            log_file_path = log_dir / "nextlevelapex.log"
            file_handler = RotatingFileHandler(
                log_file_path, maxBytes=5 * 1024 * 1024, backupCount=5
            )
            file_handler.setFormatter(logging.Formatter(log_format, date_format))
            handlers.append(file_handler)
            print(f"INFO: Logging to file: {log_file_path}")
        except Exception as e:
            print(
                f"ERROR: Could not set up file logging at {log_dir}: {e}",
                file=sys.stderr,
            )

    root_logger = logging.getLogger()
    if root_logger.hasHandlers():
        root_logger.handlers.clear()

    logging.basicConfig(level=level, format=log_format, datefmt=date_format, handlers=handlers)

    LoggerProxy(__name__).debug(
        f"Logging initialized. Level: {level_str}. Rich: {RICH_AVAILABLE}. File logging: {script_behavior_config.get('log_to_file', True)}"
    )
