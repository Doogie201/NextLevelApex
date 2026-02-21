"""
Maintenance utilities for NextLevelApex.
Includes automated report archiving to prevent storage bloat.
"""

import tarfile
from datetime import datetime
from pathlib import Path

import typer

from nextlevelapex.core.logger import LoggerProxy

log = LoggerProxy(__name__)


def archive_old_reports(reports_dir: Path, dry_run: bool = False) -> None:
    """
    Scans the given reports directory for .html and .md files.
    Identifies files generated in previous months (not the current month),
    groups them by month, compresses them into a single .tar.gz archive
    per month, and deletes the original files.
    """
    if not reports_dir.exists() or not reports_dir.is_dir():
        log.warning(f"Reports directory {reports_dir} does not exist. Nothing to archive.")
        return

    archives_dir = reports_dir / "archives"

    if not dry_run:
        archives_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now()
    current_month_key = now.strftime("%Y_%m")  # e.g., "2026_02"

    # 1. Collect and group old reports by month
    # Group format: { "2026_01": [Path(...), Path(...)], "2025_12": [...] }
    old_reports: dict[str, list[Path]] = {}

    for file_path in reports_dir.glob("*"):
        if not file_path.is_file() or file_path.suffix not in [".html", ".md"]:
            continue

        try:
            # We use modification time to determine file age
            mtime = file_path.stat().st_mtime
            file_date = datetime.fromtimestamp(mtime)
            month_key = file_date.strftime("%Y_%m")

            # Identify reports that aren't from the modern month
            if month_key != current_month_key:
                if month_key not in old_reports:
                    old_reports[month_key] = []
                old_reports[month_key].append(file_path)
        except Exception as e:
            log.error(f"Failed to read metadata for {file_path.name}: {e}")

    if not old_reports:
        typer.secho("No old reports found inside the reports directory.", fg=typer.colors.GREEN)
        return

    # 2. Archive and clean up each group
    for month_key, files in old_reports.items():
        archive_name = f"reports_{month_key}.tar.gz"
        archive_path = archives_dir / archive_name

        if dry_run:
            typer.secho(
                f"DRY RUN: Would compress {len(files)} files into {archive_path}",
                fg=typer.colors.YELLOW,
            )
            for f in files:
                typer.echo(f"  - Would delete: {f.name}")
            continue

        typer.secho(
            f"Archiving {len(files)} reports into {archive_path.name}...", fg=typer.colors.CYAN
        )

        try:
            # Open a single tarfile and add all old reports for this month
            with tarfile.open(str(archive_path), "w:gz") as tar:
                for file_path in files:
                    tar.add(str(file_path), arcname=file_path.name)

            # 3. Clean up the source files after successful compression
            for file_path in files:
                file_path.unlink()

            typer.secho(
                f"Successfully archived {len(files)} files for {month_key}.", fg=typer.colors.GREEN
            )

        except Exception as e:
            log.error(f"Failed to create archive {archive_name}: {e}")
            typer.secho(f"Failed to archive files for {month_key}: {e}", fg=typer.colors.RED)

    typer.secho("Report archiving cycle complete.", fg=typer.colors.GREEN, bold=True)
