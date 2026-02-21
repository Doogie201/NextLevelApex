import { useMemo, useState } from "react";

import { DashboardScreen } from "./components/DashboardScreen";
import { DetailsScreen } from "./components/DetailsScreen";
import { TasksScreen } from "./components/TasksScreen";
import { parseDiagnoseLine } from "./engine/diagnoseParser";
import { createDemoRunner } from "./engine/demoRunner";
import { runCommand } from "./engine/nlxBridge";
import { mapDiagnoseToBadge } from "./engine/status";
import { deriveTaskResult, parseTaskNames } from "./engine/taskParser";
import type { CommandRunner } from "./engine/nlxBridge";
import type { HealthBadgeStatus } from "./engine/types";
import "./styles/app.css";

type Screen = "dashboard" | "tasks" | "details";

function formatLocalTimestamp(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>("dashboard");
  const [healthStatus, setHealthStatus] = useState<HealthBadgeStatus>("BROKEN");
  const [lastRunAt, setLastRunAt] = useState("");
  const [taskResult, setTaskResult] = useState("UNKNOWN");
  const [tasks, setTasks] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState("");
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");

  const runner: CommandRunner = useMemo(() => createDemoRunner(), []);

  async function runDiagnose(): Promise<void> {
    const result = await runCommand("diagnose", {}, runner, 4500);
    setStdout(result.stdout.trim());
    setStderr(result.stderr.trim());

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      setHealthStatus("BROKEN");
      setTaskResult("BROKEN");
      setLastRunAt(formatLocalTimestamp(new Date()));
      return;
    }

    try {
      const parsed = parseDiagnoseLine(result.stdout.split(/\r?\n/)[0] ?? "");
      const badge = mapDiagnoseToBadge(parsed);
      setHealthStatus(badge);
      setTaskResult(badge);
    } catch {
      setHealthStatus("BROKEN");
      setTaskResult("BROKEN");
    }

    setLastRunAt(formatLocalTimestamp(new Date()));
  }

  async function refreshTasks(): Promise<void> {
    const result = await runCommand("listTasks", {}, runner, 4500);
    setStdout(result.stdout.trim());
    setStderr(result.stderr.trim());

    if (result.exitCode !== 0) {
      setTaskResult("FAIL");
      return;
    }

    const parsedTasks = parseTaskNames(result.stdout);
    setTasks(parsedTasks);
    const firstTask = parsedTasks.length > 0 ? parsedTasks[0] : undefined;
    if (!selectedTask && firstTask) {
      setSelectedTask(firstTask);
    }
  }

  async function runTaskDryRun(): Promise<void> {
    if (!selectedTask) {
      return;
    }

    const result = await runCommand("dryRunTask", { taskName: selectedTask }, runner, 8000);
    setStdout(result.stdout.trim());
    setStderr(result.stderr.trim());

    if (result.exitCode !== 0) {
      setTaskResult("FAIL");
      return;
    }

    setTaskResult(deriveTaskResult(result.stdout));
    setLastRunAt(formatLocalTimestamp(new Date()));
  }

  return (
    <>
      <header className="app-header">
        <h1>NextLevelApex GUI</h1>
        <p className="subtle">Local-first observability and dry-run diagnostics.</p>
      </header>

      <nav className="nav-tabs" aria-label="Primary">
        <button
          className={activeScreen === "dashboard" ? "active" : ""}
          onClick={() => setActiveScreen("dashboard")}
        >
          Dashboard
        </button>
        <button className={activeScreen === "tasks" ? "active" : ""} onClick={() => setActiveScreen("tasks")}>
          Tasks
        </button>
        <button
          className={activeScreen === "details" ? "active" : ""}
          onClick={() => setActiveScreen("details")}
        >
          Details
        </button>
      </nav>

      {activeScreen === "dashboard" && (
        <DashboardScreen status={healthStatus} lastRunAt={lastRunAt} onRunDiagnose={runDiagnose} />
      )}

      {activeScreen === "tasks" && (
        <TasksScreen
          tasks={tasks}
          selectedTask={selectedTask}
          onSelectTask={setSelectedTask}
          onRefreshTasks={refreshTasks}
          onRunTask={runTaskDryRun}
          taskResult={taskResult}
        />
      )}

      {activeScreen === "details" && <DetailsScreen stdout={stdout} stderr={stderr} />}
    </>
  );
}
