# nextlevelapex/core/report.py

import html
import json
from datetime import datetime
from pathlib import Path
from typing import Any


def markdown_escape(text: str) -> str:
    return str(text).replace("|", "\\|")


def _trunc(val: Any, max_len: int) -> str:
    """Predictable truncation to align reports with state ingestion."""
    s = str(val)
    if len(s) > max_len:
        return s[:max_len] + "...[TRUNCATED]"
    return s


def get_health_summary(state: dict[str, Any]) -> str:
    lines = [
        "| Task | Status | Last Healthy | Trend |",
        "|------|--------|-------------|-------|",
    ]
    for task, status in state.get("task_status", {}).items():
        # Truncate to align with Phase 2 bounds (defense in depth)
        safe_task = _trunc(task, 128)
        safe_status = _trunc(status["status"], 16)
        last_healthy = _trunc(status.get("last_healthy", "--"), 64)

        recent = state.get("health_history", {}).get(task, [])
        trend = _trunc(" ".join([e["status"][0] for e in recent[-5:]]) if recent else "-", 16)

        lines.append(
            f"| {markdown_escape(safe_task)} | {markdown_escape(safe_status)} | {markdown_escape(last_healthy)} | {trend} |"
        )
    return "\n".join(lines)


def get_health_detail(state: dict[str, Any], depth: int = 5) -> str:
    output = []
    for task, history in state.get("health_history", {}).items():
        safe_task = _trunc(task, 128)
        output.append(f"### Task: `{safe_task}`\n")

        for entry in history[-depth:]:
            raw_details = (
                json.dumps(entry.get("details", {}), indent=2) if "details" in entry else ""
            )

            safe_ts = _trunc(entry["timestamp"], 64)
            safe_st = _trunc(entry["status"], 16)
            safe_det = _trunc(raw_details, 8192)

            output.append(f"- {safe_ts}: **{safe_st}** {safe_det}")
        output.append("")
    return "\n".join(output)


def generate_markdown_report(state: dict[str, Any], out_dir: Path) -> Path:
    now = datetime.utcnow().replace(microsecond=0).isoformat().replace(":", "-")
    out_dir.mkdir(parents=True, exist_ok=True)
    latest = out_dir / "nextlevelapex-latest.md"
    stamped = out_dir / f"nextlevelapex-{now}.md"
    summary = get_health_summary(state)
    detail = get_health_detail(state, depth=10)
    versions = state.get("service_versions", {})

    content = "# NextLevelApex Health Report\n"
    content += f"Generated: {now} UTC\n\n"
    content += "## Service Versions\n```\n"
    content += json.dumps(versions, indent=2)
    content += "\n```\n\n## Summary Table\n"
    content += summary
    content += "\n\n## Task Details\n"
    content += detail

    from nextlevelapex.core.io import atomic_write_text

    atomic_write_text(latest, content)
    atomic_write_text(stamped, content)
    return stamped


def _trunc(val: Any, max_len: int) -> str:
    s = str(val)
    if len(s) > max_len:
        return s[:max_len] + "...[TRUNCATED]"
    return s


def generate_html_report(state: dict[str, Any], out_dir: Path) -> Path:
    now = datetime.utcnow().replace(microsecond=0).isoformat().replace(":", "-")
    out_dir.mkdir(parents=True, exist_ok=True)
    latest = out_dir / "nextlevelapex-latest.html"
    stamped = out_dir / f"nextlevelapex-{now}.html"
    versions = html.escape(
        _trunc(json.dumps(state.get("service_versions", {}), indent=2), 8192), quote=True
    )

    # Simple HTML. For fancier reporting, plug in a template engine later.
    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>NextLevelApex Health Report</title>
  <style>
    body {{ font-family: sans-serif; margin: 2em; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border: 1px solid #ccc; padding: 0.5em; text-align: left; }}
    th {{ background: #eee; }}
    pre {{ background: #f5f5f5; padding: 1em; border-radius: 4px; }}
  </style>
</head>
<body>
<h1>NextLevelApex Health Report</h1>
<p>Generated: {html.escape(_trunc(now, 64), quote=True)} UTC</p>
<h2>Service Versions</h2>
<pre>{versions}</pre>
<h2>Summary Table</h2>
<table>
  <tr><th>Task</th><th>Status</th><th>Last Healthy</th><th>Trend</th></tr>
"""
    # Render summary rows
    for task, status in state.get("task_status", {}).items():
        last_healthy = html.escape(_trunc(status.get("last_healthy", "--"), 64), quote=True)
        recent = state.get("health_history", {}).get(task, [])
        trend_str = " ".join([e["status"][0] for e in recent[-5:]]) if recent else "-"
        trend = html.escape(_trunc(trend_str, 64), quote=True)
        safe_task = html.escape(_trunc(task, 128), quote=True)
        safe_status = html.escape(_trunc(status.get("status", ""), 16), quote=True)
        html_content += f"<tr><td>{safe_task}</td><td>{safe_status}</td><td>{last_healthy}</td><td>{trend}</td></tr>\n"
    html_content += "</table>\n<h2>Task Details</h2>\n"
    for task, history in state.get("health_history", {}).items():
        safe_task_hdr = html.escape(_trunc(task, 128), quote=True)
        html_content += f"<h3>{safe_task_hdr}</h3><ul>"
        for entry in history[-10:]:
            details = entry.get("details", "")
            safe_ts = html.escape(_trunc(entry.get("timestamp", ""), 64), quote=True)
            safe_st = html.escape(_trunc(entry.get("status", ""), 16), quote=True)
            det_str = json.dumps(details, indent=2) if details else ""
            safe_det = html.escape(_trunc(det_str, 8192), quote=True) if det_str else ""
            html_content += f"<li>{safe_ts}: <b>{safe_st}</b> <pre>{safe_det}</pre></li>"
        html_content += "</ul>"
    html_content += "</body></html>"

    from nextlevelapex.core.io import atomic_write_text

    atomic_write_text(latest, html_content)
    atomic_write_text(stamped, html_content)
    return stamped


def generate_report(
    state: dict[str, Any], out_dir: Path, as_html: bool = True, as_md: bool = True
) -> tuple[Path | None, Path | None]:
    html_path, md_path = None, None
    if as_md:
        md_path = generate_markdown_report(state, out_dir)
    if as_html:
        html_path = generate_html_report(state, out_dir)
    return html_path, md_path
