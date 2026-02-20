import asyncio
import inspect
import random
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from nextlevelapex.core.config import DEFAULT_CONFIG_PATH, generate_default_config
from nextlevelapex.core.state import get_task_health_trend, load_state, save_state
from nextlevelapex.main2 import (
    STATE_PATH,
    archive_reports_cmd,
)
from nextlevelapex.main2 import auto_fix as auto_fix_cli
from nextlevelapex.main2 import (
    discover_tasks,
    execute_remediation,
)
from nextlevelapex.main2 import export_state as export_state_cli
from nextlevelapex.main2 import (
    generate_report_cli,
    install_archiver_cmd,
)
from nextlevelapex.main2 import reset_state as reset_state_cli
from nextlevelapex.main2 import (
    run_task,
)

app = FastAPI(
    title="NextLevelApex Mission Control API",
    description="Backend API wrapper for the NextLevelApex Orchestrator",
    version="0.1.0",
)

# Allow CORS for Next.js frontend (default port 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3003", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# WebSocket Telemetry Stream
# -----------------------------------------------------------------------------
@app.websocket("/api/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()

    # Base simulated state to slowly drift
    state: dict[str, Any] = {
        "cognitive_load": 32,
        "flow_velocity": 1.8,
        "pulse_cadence": 5.5,
        "sympathetic_tone": "Low",
        "deep_work_minutes": 252,  # 4h 12m
    }

    coach_messages = [
        "I notice minor context switching in the last 15 minutes. Would you like me to initiate a 5-minute cooldown protocol?",
        "Flow velocity has increased by 0.2x. Optimal coherence maintained.",
        "Heart rate variability indicates a slight shift towards sympathetic dominance. Deep breathing recommended.",
        "You've been in a deep work state for over 4 hours. Consider a short break to maintain cognitive sustainability.",
        "System telemetry healthy. Local processing actively guarding your sovereignty.",
    ]

    try:
        while True:
            # Drift values slightly simulating live data
            state["cognitive_load"] = max(
                10, min(90, int(state["cognitive_load"]) + random.randint(-5, 5))
            )
            state["flow_velocity"] = round(
                max(0.5, min(3.0, float(state["flow_velocity"]) + random.uniform(-0.1, 0.1))), 2
            )
            state["pulse_cadence"] = round(
                max(4.0, min(8.0, float(state["pulse_cadence"]) + random.uniform(-0.5, 0.5))), 1
            )

            # Periodically add a coach event (1 in 10 chance)
            coach_event = None
            if random.random() < 0.1:
                coach_event = random.choice(coach_messages)

            payload = {
                "type": "telemetry_update",
                "timestamp": datetime.utcnow().isoformat(),
                "metrics": state,
                "coach_alert": coach_event,
            }

            await websocket.send_json(payload)
            await asyncio.sleep(2.0)  # Send update every 2 seconds

    except WebSocketDisconnect:
        print("Client disconnected from telemetry stream")


class DiagnoseRequest(BaseModel):
    task_name: str
    autofix: bool = False


class GlobalRunRequest(BaseModel):
    mode: str = "run"
    dry_run: bool = False
    task_filters: list[str] | None = None
    no_reports: bool = False


class ExportRequest(BaseModel):
    fmt: str = "json"


class ResetStateRequest(BaseModel):
    only_failed: bool = False
    backup: bool = True


class AutoFixRequest(BaseModel):
    dry_run: bool = False


@app.get("/api/tasks")
def list_tasks() -> dict[str, Any]:
    """Returns all discovered tasks and their current state."""
    state = load_state(STATE_PATH)
    tasks = state.get("task_status", {})
    return {"tasks": tasks}


@app.get("/api/health")
def health_history(task_name: str | None = None) -> dict[str, Any]:
    """Returns the health history for a task or all tasks."""
    state = load_state(STATE_PATH)
    if task_name:
        history = get_task_health_trend(task_name, state)
        return {"history": {task_name: history}}

    return {"history": state.get("health_history", {})}


@app.get("/api/tasks/{task_name}")
def get_task_detail(task_name: str) -> dict[str, Any]:
    """Returns details and history about a specific task."""
    discovered = discover_tasks()
    if task_name not in discovered:
        raise HTTPException(status_code=404, detail="Task not found in registry.")

    task_callable = discovered[task_name]
    docstring = inspect.getdoc(task_callable) or "No documentation provided."

    state = load_state(STATE_PATH)
    history = get_task_health_trend(task_name, state)
    status_info = state.get("task_status", {}).get(task_name, {})

    return {"name": task_name, "docstring": docstring, "status": status_info, "history": history}


@app.post("/api/run")
def trigger_run(req: GlobalRunRequest) -> dict[str, Any]:
    """Triggers a run across discovered tasks, matching CLI options."""
    state = load_state(STATE_PATH)
    discovered_tasks = discover_tasks()
    now = datetime.utcnow().isoformat()

    # Apply task filters similar to main2.py
    if req.task_filters:
        filtered = {}
        target_lower_list = [t.lower() for t in req.task_filters]
        for name, callable_def in discovered_tasks.items():
            name_lower = name.lower()
            if any(t in name_lower for t in target_lower_list):
                filtered[name] = callable_def
        discovered_tasks = filtered

    results = {}
    for name, task_callable in discovered_tasks.items():
        context = {
            "mode": req.mode,
            "dry_run": req.dry_run,
            "state": state,
            "now": now,
        }
        try:
            res = run_task(name, task_callable, context)
            results[name] = {"status": "success", "data": res}
        except Exception as e:
            results[name] = {"status": "error", "message": str(e)}

    # Generate reports if not skipped
    skip_reports = req.no_reports or req.task_filters
    if not skip_reports:
        try:
            generate_report_cli(html=True, markdown=True)
        except Exception as e:
            results["_report_generation"] = {"status": "error", "message": str(e)}

    return {"status": "completed", "results": results}


@app.post("/api/diagnose")
def trigger_diagnose(req: DiagnoseRequest) -> dict[str, Any]:
    """Runs a deep diagnosis on a specific task."""
    state = load_state(STATE_PATH)
    discovered_tasks = discover_tasks()

    if req.task_name not in discovered_tasks:
        raise HTTPException(status_code=404, detail=f"Task '{req.task_name}' not found.")

    task_callable = discovered_tasks[req.task_name]
    context = {
        "mode": "diagnose",
        "state": state,
        "now": datetime.utcnow().isoformat(),
        "autofix": req.autofix,
    }

    try:
        result = run_task(req.task_name, task_callable, context)
        logs = []

        if req.autofix and "remediation_plan" in result:
            plan = result["remediation_plan"]
            logs.append(f"Initiating Remediation: {plan.get('description')}")

            actions_successful = True
            for i, action in enumerate(plan.get("actions", [])):
                logs.append(f"Executing step {i+1}: {action['action_type']}")
                success = execute_remediation(action)
                if not success:
                    actions_successful = False
                    logs.append(f"Step {i+1} failed to execute.")
                    break

            if actions_successful:
                logs.append("Re-running task to verify fix...")
                post_context = {
                    "mode": "run",
                    "dry_run": False,
                    "state": state,
                    "now": datetime.utcnow().isoformat(),
                }
                post_result = run_task(req.task_name, task_callable, post_context)

                if post_result.get("status") == "PASS":
                    state["task_status"][req.task_name] = {
                        "status": "PASS",
                        "last_update": post_context["now"],
                    }
                    save_state(state, STATE_PATH)
                    logs.append("Verification SUCCESS. Task healed.")
                    result["status"] = "PASS"
                else:
                    logs.append("Verification FAILED. Task remains unhealthy.")
                    result["status"] = "FAIL"

            result["healing_logs"] = logs

        return {"status": "success", "result": result}
    except Exception as e:
        import traceback as tb

        return {"status": "error", "message": str(e), "traceback": tb.format_exc()}


@app.post("/api/autofix")
def autofix_global(req: AutoFixRequest) -> dict[str, Any]:
    """Run global autofix routine (Advanced Meta-Level Healing Protocol)."""
    try:
        # Wrap the Typer output stream temporarily
        auto_fix_cli(dry_run=req.dry_run)
        return {"status": "success", "message": "Autofix protocol completed."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/reset")
def reset_system_state(req: ResetStateRequest) -> dict[str, Any]:
    """Resets the state tracking document."""
    try:
        reset_state_cli(only_failed=req.only_failed, backup=req.backup)
        return {"status": "success", "message": "State reset successfully."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/report")
def generate_reports() -> dict[str, Any]:
    """Generates the HTML and Markdown reports manually."""
    try:
        generate_report_cli(html=True, markdown=True)
        return {"status": "success", "message": "Reports generated."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/export")
def export_system_state(req: ExportRequest) -> dict[str, Any]:
    """Exports orchestrator state."""
    try:
        export_state_cli(fmt=req.fmt)
        return {"status": "success", "message": f"State exported successfully in {req.fmt} format."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/config/generate")
def generate_default_config_api(force: bool = False) -> dict[str, Any]:
    """Generates the default configuration."""
    if DEFAULT_CONFIG_PATH.exists() and not force:
        raise HTTPException(status_code=400, detail="Config already exists. Use force=true.")

    DEFAULT_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    ok = generate_default_config(DEFAULT_CONFIG_PATH)
    if ok:
        return {"status": "success", "message": f"Config written to {DEFAULT_CONFIG_PATH}"}
    return {"status": "error", "message": "Failed to create config."}


@app.post("/api/maintenance/archive")
def trigger_archiver(dry_run: bool = False) -> dict[str, Any]:
    """Archives old reports."""
    try:
        archive_reports_cmd(dry_run=dry_run)
        return {"status": "success", "message": "Archiving process complete."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/maintenance/install-archiver")
def install_launchd_archiver() -> dict[str, Any]:
    """Installs the macOS launchd monthly archiver."""
    try:
        install_archiver_cmd()
        return {"status": "success", "message": "Auto-archiver installed successfully."}
    except Exception as e:
        return {"status": "error", "message": str(e)}
