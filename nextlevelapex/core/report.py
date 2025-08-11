# nextlevelapex/core/report.py

import json
from datetime import datetime
from pathlib import Path
from typing import Any


def markdown_escape(text: str) -> str:
    return str(text).replace("|", "\\|")


def get_health_summary(state: dict[str, Any]) -> str:
    lines = [
        "| Task | Status | Last Healthy | Trend |",
        "|------|--------|-------------|-------|",
    ]
    for task, status in state.get("task_status", {}).items():
        last_healthy = status.get("last_healthy", "--")
        recent = state.get("health_history", {}).get(task, [])
        trend = " ".join([e["status"][0] for e in recent[-5:]]) if recent else "-"
        lines.append(
            f"| {markdown_escape(task)} | {markdown_escape(status['status'])} | {markdown_escape(last_healthy)} | {trend} |"
        )
    return "\n".join(lines)


def get_health_detail(state: dict[str, Any], depth: int = 5) -> str:
    output = []
    for task, history in state.get("health_history", {}).items():
        output.append(f"### Task: `{task}`\n")
        for entry in history[-depth:]:
            details = json.dumps(entry.get("details", {}), indent=2) if "details" in entry else ""
            output.append(f"- {entry['timestamp']}: **{entry['status']}** {details}")
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

    with latest.open("w") as f:
        f.write("# NextLevelApex Health Report\n")
        f.write(f"Generated: {now} UTC\n\n")
        f.write("## Service Versions\n")
        f.write("```\n")
        json.dump(versions, f, indent=2)
        f.write("\n```\n\n")
        f.write("## Summary Table\n")
        f.write(summary)
        f.write("\n\n## Task Details\n")
        f.write(detail)
    # Save a timestamped copy for history
    latest.replace(stamped)
    latest.write_text((stamped).read_text())
    return stamped


def generate_html_report(state: dict[str, Any], out_dir: Path) -> Path:
    now = datetime.utcnow().replace(microsecond=0).isoformat().replace(":", "-")
    out_dir.mkdir(parents=True, exist_ok=True)
    latest = out_dir / "nextlevelapex-latest.html"
    stamped = out_dir / f"nextlevelapex-{now}.html"
    versions = json.dumps(state.get("service_versions", {}), indent=2)

    # Simple HTML. For fancier reporting, plug in a template engine later.
    html = f"""<!DOCTYPE html>
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
<p>Generated: {now} UTC</p>
<h2>Service Versions</h2>
<pre>{versions}</pre>
<h2>Summary Table</h2>
<table>
  <tr><th>Task</th><th>Status</th><th>Last Healthy</th><th>Trend</th></tr>
"""
    # Render summary rows
    for task, status in state.get("task_status", {}).items():
        last_healthy = status.get("last_healthy", "--")
        recent = state.get("health_history", {}).get(task, [])
        trend = " ".join([e["status"][0] for e in recent[-5:]]) if recent else "-"
        html += f"<tr><td>{task}</td><td>{status['status']}</td><td>{last_healthy}</td><td>{trend}</td></tr>\n"
    html += "</table>\n<h2>Task Details</h2>\n"
    for task, history in state.get("health_history", {}).items():
        html += f"<h3>{task}</h3><ul>"
        for entry in history[-10:]:
            details = entry.get("details", "")
            html += f"<li>{entry['timestamp']}: <b>{entry['status']}</b> <pre>{json.dumps(details, indent=2) if details else ''}</pre></li>"
        html += "</ul>"
    html += "</body></html>"

    latest.write_text(html)
    # Save a timestamped copy for history
    latest.replace(stamped)
    latest.write_text((stamped).read_text())
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
