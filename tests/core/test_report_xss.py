import html
import json
from pathlib import Path

from nextlevelapex.core.report import generate_html_report


def test_html_report_escapes_xss(tmp_path: Path):
    """
    Ensure that potentially malicious input in the state history
    does not render as raw HTML in the generated report.
    """
    malicious_task_name = "<script>alert('xss-task')</script>"
    malicious_status = "<img src=x>"
    malicious_last_healthy = "<strong>1-1-1970</strong>"
    malicious_trend = "<scr>OK</scr>"
    malicious_detail = {"msg": "<svg/onload=1>"}

    mock_state = {
        "service_versions": {"foo": "<script>alert('xss-version')</script>"},
        "task_status": {
            malicious_task_name: {
                "status": malicious_status,
                "last_healthy": malicious_last_healthy,
            }
        },
        "health_history": {
            malicious_task_name: [
                {
                    "timestamp": "2026-01-01T00:00:00",
                    "status": malicious_trend,
                    "details": malicious_detail,
                }
            ]
        },
    }

    out_dir = tmp_path / "reports"
    report_file = generate_html_report(mock_state, out_dir)

    assert report_file.exists()
    content = report_file.read_text()

    # The raw malicious strings should NOT be in the HTML content
    assert "<script>alert('xss-task')</script>" not in content
    assert "<img src=x onerror=alert('xss-status')>" not in content

    # We expect the escaped versions to be present
    assert html.escape(malicious_task_name) in content
    assert html.escape(malicious_status) in content
    assert html.escape(malicious_last_healthy) in content
    assert html.escape(malicious_trend) in content
    assert html.escape(json.dumps(malicious_detail, indent=2)) in content
    assert (
        html.escape(json.dumps({"foo": "<script>alert('xss-version')</script>"}, indent=2))
        in content
    )
