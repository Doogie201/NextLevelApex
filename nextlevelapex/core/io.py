import contextlib
import os
import sys
import tempfile
from pathlib import Path


def _fsync_directory(directory: Path) -> None:
    """
    Best-effort fsync of the containing directory so the rename metadata is durable.
    Supported on Darwin/Linux; intentionally silent on failure.
    """
    platform_name = str(sys.platform)
    if not platform_name.startswith(("darwin", "linux")):
        return

    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY

    try:
        dir_fd = os.open(str(directory), flags)
    except OSError:
        return

    try:
        os.fsync(dir_fd)
    except OSError:
        pass
    finally:
        os.close(dir_fd)


def atomic_write_text(path: Path | str, content: str, perms: int | None = None) -> None:
    """
    Atomically write text content:
    1) write temp file in destination directory
    2) flush + fsync temp file
    3) optional chmod
    4) os.replace(temp, final)
    5) best-effort fsync destination directory
    """
    final_path = Path(path)
    final_path.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_name = tempfile.mkstemp(
        dir=str(final_path.parent),
        prefix=f".{final_path.name}.",
        suffix=".tmp",
        text=True,
    )
    temp_path = Path(temp_name)

    try:
        try:
            temp_file = os.fdopen(fd, "w", encoding="utf-8")
        except Exception:
            os.close(fd)
            raise

        with temp_file:
            temp_file.write(content)
            temp_file.flush()
            os.fsync(temp_file.fileno())

        if perms is not None:
            os.chmod(temp_path, perms)  # noqa: PTH101

        os.replace(temp_path, final_path)  # noqa: PTH105
        _fsync_directory(final_path.parent)
    except Exception:
        with contextlib.suppress(OSError):
            temp_path.unlink()
        raise
