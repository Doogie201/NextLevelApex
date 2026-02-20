from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from nextlevelapex.core.state import get_task_health_trend, load_state, save_state
from nextlevelapex.main2 import STATE_PATH, discover_tasks, run_task, execute_remediation

app = FastAPI(
    title="NextLevelApex Mission Control API",
    description="Backend API wrapper for the NextLevelApex Orchestrator",
    version="0.1.0",
)

# Allow CORS for Next.js frontend (default port 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DiagnoseRequest(BaseModel):
    task_name: str
    autofix: bool = False

class GlobalRunRequest(BaseModel):
    mode: str = "run"
    dry_run: bool = False

@app.get("/api/tasks")
def list_tasks() -> Dict[str, Any]:
    """Returns all discovered tasks and their current state."""
    state = load_state(STATE_PATH)
    tasks = state.get("task_status", {})
    return {"tasks": tasks}

@app.get("/api/health")
def health_history(task_name: Optional[str] = None) -> Dict[str, Any]:
    """Returns the health history for a task or all tasks."""
    state = load_state(STATE_PATH)
    if task_name:
        history = get_task_health_trend(task_name, state)
        return {"history": {task_name: history}}

    return {"history": state.get("health_history", {})}

@app.post("/api/run")
def trigger_run(req: GlobalRunRequest) -> Dict[str, Any]:
    """Triggers a global run across all discovered tasks."""
    # Similar to main2.py main() logic
    state = load_state(STATE_PATH)
    discovered_tasks = discover_tasks()
    now = datetime.utcnow().isoformat()

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

    return {"status": "completed", "results": results}

@app.post("/api/diagnose")
def trigger_diagnose(req: DiagnoseRequest) -> Dict[str, Any]:
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
                post_context = {"mode": "run", "dry_run": False, "state": state, "now": datetime.utcnow().isoformat()}
                post_result = run_task(req.task_name, task_callable, post_context)

                if post_result.get("status") == "PASS":
                    state["task_status"][req.task_name] = {"status": "PASS", "last_update": post_context["now"]}
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
