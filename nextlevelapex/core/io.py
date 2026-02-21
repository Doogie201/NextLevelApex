import os
import tempfile
from pathlib import Path


def atomic_write_text(path: Path | str, content: str, perms: int | None = None) -> None:
    """
    Writes content to a temporary file, fsyncs it, and then replaces the target
    atomically. Handles fsyncing the directory on POSIX platforms.
    """
    path = Path(path).resolve()
    dir_path = path.parent
    dir_path.mkdir(parents=True, exist_ok=True)

    # Write to a mkstemp in the exact same directory to ensure they
    # are on the same filesystem (which makes os.replace atomic).
    fd, tmp_path = tempfile.mkstemp(dir=dir_path, text=True)
    try:
        with open(fd, "w") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())

        if perms is not None:
            Path(tmp_path).chmod(perms)

        Path(tmp_path).replace(path)

        # Best effort attempt to fsync the directory to persist the directory entry rename
        if hasattr(os, "O_DIRECTORY"):
            try:
                dir_fd = os.open(dir_path, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
            except OSError:
                pass

    except Exception:
        # Clean up the temp file if anything fails
        import contextlib

        with contextlib.suppress(OSError):
            Path(tmp_path).unlink()
        raise
