#!/usr/bin/env python3
"""Compatibility shim for the canonical NextLevelApex CLI entrypoint.

Canonical CLI entrypoint: ``nextlevelapex.main2``.

This module intentionally preserves legacy invocations like:
    python -m nextlevelapex.main run --dry-run
by forwarding to the canonical Typer app in ``nextlevelapex.main2``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from nextlevelapex.core.task import TaskContext

__all__ = ["TaskContext", "main"]


def _load_canonical_app() -> Any:
    """Import and return the canonical Typer app lazily."""
    from nextlevelapex.main2 import app as canonical_app

    return canonical_app


def __getattr__(name: str) -> Any:
    """Expose ``app`` lazily for compatibility imports."""
    if name == "app":
        return _load_canonical_app()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def _normalize_legacy_args(argv: Sequence[str]) -> list[str]:
    """Drop legacy ``run`` subcommand and forward remaining args."""
    args = list(argv)
    if args and args[0] == "run":
        return args[1:]
    return args


def main(argv: Sequence[str] | None = None) -> int:
    """Forward CLI execution to the canonical app, preserving old syntax."""
    import sys

    args = _normalize_legacy_args(sys.argv[1:] if argv is None else argv)
    canonical_app = _load_canonical_app()

    try:
        canonical_app(prog_name="python -m nextlevelapex.main", args=args)
    except SystemExit as exc:
        code = exc.code
        return code if isinstance(code, int) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
