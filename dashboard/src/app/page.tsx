"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  ListChecks,
  Play,
  Shield,
  TerminalSquare,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CommandId } from "@/engine/commandContract";

interface DiagnoseSummary {
  dnsMode: string;
  resolver: string;
  pihole: string;
  piholeUpstream: string;
  cloudflared: string;
  plaintextDns: string;
  notes: string;
}

interface TaskResult {
  taskName: string;
  status: "PASS" | "FAIL" | "WARN" | "SKIP" | "UNKNOWN";
  reason: string;
}

type HealthBadge = "OK" | "DEGRADED" | "BROKEN";
type CommandErrorType =
  | "missing_nlx"
  | "permission"
  | "timeout"
  | "aborted"
  | "spawn_error"
  | "nonzero_exit"
  | "none";

type CommandOutcome = "RUNNING" | "PASS" | "WARN" | "FAIL";
type ViewId = "dashboard" | "tasks" | "output";

interface CommandResponse {
  ok: boolean;
  commandId: CommandId;
  exitCode: number;
  timedOut: boolean;
  errorType: CommandErrorType;
  stdout: string;
  stderr: string;
  taskNames?: string[];
  taskResults?: TaskResult[];
  diagnose?: {
    summary: DiagnoseSummary;
    badge: HealthBadge;
  };
  error?: string;
  httpStatus: number;
}

interface CommandEvent {
  id: string;
  commandId: CommandId;
  label: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outcome: CommandOutcome;
  note: string;
  stdout: string;
  stderr: string;
}

function formatTimestamp(isoTime: string): string {
  return new Date(isoTime).toLocaleString();
}

function formatDuration(durationMs?: number): string {
  if (!durationMs || durationMs < 0) {
    return "--";
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function labelForCommand(commandId: CommandId, taskName?: string): string {
  if (commandId === "diagnose") {
    return "Diagnose";
  }
  if (commandId === "listTasks") {
    return "List Tasks";
  }
  if (commandId === "dryRunAll") {
    return "Dry-Run Sweep";
  }
  return taskName ? `Dry-Run Task: ${taskName}` : "Dry-Run Task";
}

function normalizeCommandResponse(commandId: CommandId, httpStatus: number, payload: unknown): CommandResponse {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      commandId,
      exitCode: 1,
      timedOut: false,
      errorType: "spawn_error",
      stdout: "",
      stderr: `Unexpected response payload (HTTP ${httpStatus}).`,
      httpStatus,
    };
  }

  const raw = payload as Record<string, unknown>;
  const hasStructuredResponse = typeof raw.commandId === "string";

  if (!hasStructuredResponse) {
    const errorMessage = typeof raw.error === "string" ? raw.error : `Request failed (HTTP ${httpStatus}).`;
    return {
      ok: false,
      commandId,
      exitCode: 1,
      timedOut: false,
      errorType: "spawn_error",
      stdout: "",
      stderr: errorMessage,
      error: errorMessage,
      httpStatus,
    };
  }

  return {
    ok: raw.ok === true,
    commandId,
    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : 1,
    timedOut: raw.timedOut === true,
    errorType: typeof raw.errorType === "string" ? (raw.errorType as CommandErrorType) : "spawn_error",
    stdout: typeof raw.stdout === "string" ? raw.stdout : "",
    stderr: typeof raw.stderr === "string" ? raw.stderr : "",
    taskNames: Array.isArray(raw.taskNames) ? (raw.taskNames.filter((entry) => typeof entry === "string") as string[]) : [],
    taskResults: Array.isArray(raw.taskResults) ? (raw.taskResults as TaskResult[]) : [],
    diagnose: typeof raw.diagnose === "object" && raw.diagnose !== null
      ? (raw.diagnose as CommandResponse["diagnose"])
      : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
    httpStatus,
  };
}

function classifyCommandOutcome(result: CommandResponse): CommandOutcome {
  if (!result.ok) {
    return "FAIL";
  }

  if (result.commandId === "diagnose") {
    if (!result.diagnose || result.diagnose.badge === "BROKEN") {
      return "FAIL";
    }
    return result.diagnose.badge === "OK" ? "PASS" : "WARN";
  }

  if (result.taskResults && result.taskResults.some((task) => task.status === "FAIL")) {
    return "FAIL";
  }

  if (
    result.taskResults &&
    result.taskResults.some((task) => task.status === "WARN" || task.status === "UNKNOWN")
  ) {
    return "WARN";
  }

  return "PASS";
}

function summarizeCommandResult(result: CommandResponse): string {
  if (!result.ok) {
    if (result.errorType === "missing_nlx") {
      return "nlx not found. Install dependencies and verify `poetry run nlx diagnose`.";
    }
    if (result.errorType === "timeout") {
      return "Command timed out before completion.";
    }
    return result.error || result.stderr || "Command failed.";
  }

  if (result.commandId === "diagnose" && result.diagnose) {
    return result.diagnose.badge === "OK"
      ? "Diagnose confirms expected secure local DNS path."
      : "Diagnose reports degraded DNS state. Review notes.";
  }

  if (result.commandId === "listTasks") {
    return `Discovered ${result.taskNames?.length ?? 0} task(s).`;
  }

  if (result.taskResults && result.taskResults.length > 0) {
    const failures = result.taskResults.filter((task) => task.status === "FAIL").length;
    const warnings = result.taskResults.filter((task) => task.status === "WARN").length;
    if (failures > 0 || warnings > 0) {
      return `Completed with ${failures} fail / ${warnings} warn.`;
    }
    return `Completed ${result.taskResults.length} task checks with no warnings.`;
  }

  return "Command completed.";
}

function statusClass(status: CommandOutcome | TaskResult["status"]): string {
  if (status === "PASS") {
    return "status-pass";
  }
  if (status === "WARN" || status === "UNKNOWN") {
    return "status-warn";
  }
  if (status === "RUNNING") {
    return "status-running";
  }
  if (status === "SKIP") {
    return "status-skip";
  }
  return "status-fail";
}

export default function Home() {
  const [readOnly, setReadOnly] = useState(true);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [healthBadge, setHealthBadge] = useState<HealthBadge>("BROKEN");
  const [diagnoseSummary, setDiagnoseSummary] = useState<DiagnoseSummary | null>(null);
  const [knownTasks, setKnownTasks] = useState<string[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [taskResults, setTaskResults] = useState<TaskResult[]>([]);
  const [commandHistory, setCommandHistory] = useState<CommandEvent[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [friendlyMessage, setFriendlyMessage] = useState("Run diagnose to evaluate stack health.");
  const [lastRunAt, setLastRunAt] = useState("never");

  const badgeClass = useMemo(() => {
    if (healthBadge === "OK") {
      return "badge-PASS";
    }
    if (healthBadge === "DEGRADED") {
      return "badge-PENDING";
    }
    return "badge-FAIL";
  }, [healthBadge]);

  const callNlx = useCallback(async (commandId: CommandId, taskName?: string): Promise<CommandResponse> => {
    const response = await fetch("/api/nlx/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commandId, taskName }),
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return normalizeCommandResponse(commandId, response.status, payload);
  }, []);

  const appendCommandStart = useCallback((commandId: CommandId, label: string): string => {
    const eventId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const startedAt = new Date().toISOString();

    setCommandHistory((previous) => [
      {
        id: eventId,
        commandId,
        label,
        startedAt,
        outcome: "RUNNING",
        note: "Running...",
        stdout: "",
        stderr: "",
      },
      ...previous,
    ]);

    return eventId;
  }, []);

  const finalizeCommand = useCallback(
    (eventId: string, startedAtMs: number, result: CommandResponse): void => {
      const finishedAt = new Date().toISOString();
      const outcome = classifyCommandOutcome(result);
      const note = summarizeCommandResult(result);

      setCommandHistory((previous) =>
        previous.map((entry) => {
          if (entry.id !== eventId) {
            return entry;
          }
          return {
            ...entry,
            finishedAt,
            durationMs: Date.now() - startedAtMs,
            outcome,
            note,
            stdout: result.stdout,
            stderr: result.stderr,
          };
        }),
      );
    },
    [],
  );

  const executeCommand = useCallback(
    async (commandId: CommandId, taskName?: string): Promise<CommandResponse> => {
      const label = labelForCommand(commandId, taskName);
      const eventId = appendCommandStart(commandId, label);
      const startedAtMs = Date.now();
      const result = await callNlx(commandId, taskName);
      finalizeCommand(eventId, startedAtMs, result);
      return result;
    },
    [appendCommandStart, callNlx, finalizeCommand],
  );

  const loadConfig = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/gui/config", { method: "GET" });
    const payload = (await response.json()) as { readOnly: boolean };
    setReadOnly(payload.readOnly);
  }, []);

  const loadTasks = useCallback(async (): Promise<void> => {
    const result = await executeCommand("listTasks");
    if (!result.ok) {
      setFriendlyMessage(summarizeCommandResult(result));
      return;
    }

    const taskNames = result.taskNames ?? [];
    setKnownTasks(taskNames);
    setSelectedTasks((previous) => previous.filter((task) => taskNames.includes(task)));
  }, [executeCommand]);

  const runDiagnose = useCallback(async (): Promise<void> => {
    setActiveView("dashboard");
    setIsBusy(true);
    setFriendlyMessage("Running diagnose command...");

    try {
      const result = await executeCommand("diagnose");

      if (!result.ok) {
        setHealthBadge("DEGRADED");
        setFriendlyMessage(summarizeCommandResult(result));
        return;
      }

      if (!result.diagnose) {
        setHealthBadge("BROKEN");
        setFriendlyMessage("Diagnose output was missing required fields.");
        return;
      }

      setDiagnoseSummary(result.diagnose.summary);
      setHealthBadge(result.diagnose.badge);
      setFriendlyMessage(
        result.diagnose.badge === "OK"
          ? "DNS stack appears healthy and private."
          : "DNS stack is degraded. Review output timeline for details.",
      );
      setLastRunAt(new Date().toLocaleString());
    } finally {
      setIsBusy(false);
    }
  }, [executeCommand]);

  const runDryRunSweep = useCallback(async (): Promise<void> => {
    setActiveView("output");
    setIsBusy(true);
    setFriendlyMessage("Running full dry-run sweep...");

    try {
      const result = await executeCommand("dryRunAll");
      setTaskResults(result.taskResults ?? []);
      setLastRunAt(new Date().toLocaleString());
      setFriendlyMessage(result.ok ? "Dry-run sweep complete." : summarizeCommandResult(result));
    } finally {
      setIsBusy(false);
    }
  }, [executeCommand]);

  const runDryRunSelected = useCallback(async (): Promise<void> => {
    if (selectedTasks.length === 0) {
      setFriendlyMessage("Select at least one task first.");
      return;
    }

    setActiveView("output");
    setIsBusy(true);
    setFriendlyMessage(`Running dry-run for ${selectedTasks.length} task(s)...`);

    const aggregated: TaskResult[] = [];

    try {
      for (const taskName of selectedTasks) {
        if (!knownTasks.includes(taskName)) {
          aggregated.push({
            taskName,
            status: "FAIL",
            reason: "Task is no longer present in nlx list-tasks output.",
          });
          continue;
        }

        const result = await executeCommand("dryRunTask", taskName);
        if (result.taskResults && result.taskResults.length > 0) {
          aggregated.push(...result.taskResults);
          continue;
        }

        aggregated.push({
          taskName,
          status: result.ok ? "UNKNOWN" : "FAIL",
          reason: summarizeCommandResult(result),
        });
      }

      setTaskResults(aggregated);
      setLastRunAt(new Date().toLocaleString());
      setFriendlyMessage("Selected task dry-run complete.");
    } finally {
      setIsBusy(false);
    }
  }, [executeCommand, knownTasks, selectedTasks]);

  const copyEventOutput = useCallback(async (event: CommandEvent): Promise<void> => {
    const payload = [
      `${event.label}`,
      `Started: ${formatTimestamp(event.startedAt)}`,
      event.finishedAt ? `Finished: ${formatTimestamp(event.finishedAt)}` : "Finished: pending",
      event.durationMs ? `Duration: ${formatDuration(event.durationMs)}` : "Duration: --",
      `Status: ${event.outcome}`,
      "",
      "STDOUT:",
      event.stdout || "(stdout empty)",
      "",
      "STDERR:",
      event.stderr || "(stderr empty)",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(payload);
      setFriendlyMessage(`Copied redacted output for ${event.label}.`);
    } catch {
      setFriendlyMessage("Clipboard write failed in this browser context.");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadConfig();
        await Promise.all([runDiagnose(), loadTasks()]);
      } catch {
        setFriendlyMessage("Failed to initialize GUI diagnostics.");
      }
    })();
  }, [loadConfig, loadTasks, runDiagnose]);

  return (
    <div className="min-h-screen relative overflow-hidden font-sans text-sm pb-20" data-theme="run">
      <div className="bg-glow" />
      <main className="max-w-6xl mx-auto px-6 pt-12 flex flex-col gap-6">
        <header className="glass-card p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-white">NextLevelApex Dashboard</h1>
              <p className="text-white/70 mt-1">Read-only control plane for local NLX diagnose and dry-run observability.</p>
            </div>
            <div className="badge-status badge-PASS" title="Read-only mode is enforced by server config">
              <Shield className="w-4 h-4" /> READ-ONLY: {readOnly ? "ON" : "OFF"}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className={`badge-status ${badgeClass}`}>
              {healthBadge === "OK" && <CheckCircle2 className="w-4 h-4" />}
              {healthBadge !== "OK" && <AlertTriangle className="w-4 h-4" />}
              {healthBadge}
            </span>
            <span className="text-white/70">Last run: {lastRunAt}</span>
          </div>

          <p className="text-white/85">{friendlyMessage}</p>
        </header>

        <section className="glass-card p-4">
          <div className="panel-tabs" role="tablist" aria-label="Dashboard panels">
            <button
              type="button"
              className={`tab-btn ${activeView === "dashboard" ? "tab-btn-active" : ""}`}
              onClick={() => setActiveView("dashboard")}
              role="tab"
              aria-selected={activeView === "dashboard"}
            >
              <Activity className="w-4 h-4" /> Dashboard
            </button>
            <button
              type="button"
              className={`tab-btn ${activeView === "tasks" ? "tab-btn-active" : ""}`}
              onClick={() => setActiveView("tasks")}
              role="tab"
              aria-selected={activeView === "tasks"}
            >
              <ListChecks className="w-4 h-4" /> Tasks
            </button>
            <button
              type="button"
              className={`tab-btn ${activeView === "output" ? "tab-btn-active" : ""}`}
              onClick={() => setActiveView("output")}
              role="tab"
              aria-selected={activeView === "output"}
            >
              <TerminalSquare className="w-4 h-4" /> Output
            </button>
          </div>
        </section>

        <AnimatePresence mode="wait">
          {activeView === "dashboard" && (
            <motion.section
              key="dashboard"
              className="glass-card p-6 flex flex-col gap-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="text-xl font-semibold text-white">Run Panel</h2>
              <div className="flex gap-3 flex-wrap">
                <button className="btn-theme" onClick={() => void runDiagnose()} disabled={isBusy}>
                  <Activity className="w-4 h-4" /> Run Diagnose
                </button>
                <button className="btn-theme" onClick={() => void runDryRunSweep()} disabled={isBusy}>
                  <Play className="w-4 h-4" /> Run Dry-Run Sweep
                </button>
              </div>
              {diagnoseSummary && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-white/85">
                  <div>
                    <strong>DNS Mode:</strong> {diagnoseSummary.dnsMode}
                  </div>
                  <div>
                    <strong>Resolver:</strong> {diagnoseSummary.resolver}
                  </div>
                  <div>
                    <strong>Pi-hole:</strong> {diagnoseSummary.pihole}
                  </div>
                  <div>
                    <strong>Cloudflared:</strong> {diagnoseSummary.cloudflared}
                  </div>
                  <div>
                    <strong>Upstream:</strong> {diagnoseSummary.piholeUpstream}
                  </div>
                  <div>
                    <strong>Plaintext DNS:</strong> {diagnoseSummary.plaintextDns}
                  </div>
                </div>
              )}
            </motion.section>
          )}

          {activeView === "tasks" && (
            <motion.section
              key="tasks"
              className="glass-card p-6 flex flex-col gap-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="text-xl font-semibold text-white">Task Dry-Run</h2>
              <p className="text-white/70">
                Task names come from <code>nlx list-tasks</code> and are validated server-side.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-auto pr-2">
                {knownTasks.map((task) => (
                  <label key={task} className="flex items-center gap-2 text-white/90">
                    <input
                      type="checkbox"
                      checked={selectedTasks.includes(task)}
                      onChange={(event) => {
                        setSelectedTasks((previous) =>
                          event.target.checked
                            ? [...previous, task]
                            : previous.filter((entry) => entry !== task),
                        );
                      }}
                    />
                    {task}
                  </label>
                ))}
              </div>

              <div className="flex gap-3 flex-wrap">
                <button className="btn-theme" onClick={() => void loadTasks()} disabled={isBusy}>
                  Refresh Task List
                </button>
                <button
                  className="btn-theme"
                  onClick={() => void runDryRunSelected()}
                  disabled={isBusy || selectedTasks.length === 0}
                >
                  Run Selected Tasks
                </button>
              </div>

              <div className="overflow-auto">
                <table className="w-full text-left text-white/90">
                  <thead>
                    <tr className="text-white/60 text-xs uppercase">
                      <th className="py-2">Task</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskResults.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-3 text-white/60">
                          No task output yet.
                        </td>
                      </tr>
                    ) : (
                      taskResults.map((result) => (
                        <tr
                          key={`${result.taskName}-${result.status}-${result.reason}`}
                          className="border-t border-white/10 align-top"
                        >
                          <td className="py-2 pr-3">{result.taskName}</td>
                          <td className="py-2 pr-3">
                            <span className={`status-pill ${statusClass(result.status)}`}>{result.status}</span>
                          </td>
                          <td className="py-2">{result.reason}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </motion.section>
          )}

          {activeView === "output" && (
            <motion.section
              key="output"
              className="glass-card p-6 flex flex-col gap-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="text-xl font-semibold text-white">Live Output Viewer</h2>
              <p className="text-white/70">Command timeline with redacted output, status, timestamps, and durations.</p>

              {commandHistory.length === 0 ? (
                <p className="text-white/60">No command activity yet.</p>
              ) : (
                <div className="timeline-list" role="list" aria-label="Command timeline">
                  {commandHistory.map((event) => (
                    <article key={event.id} className="timeline-item" role="listitem">
                      <header className="timeline-header">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`status-pill ${statusClass(event.outcome)}`}>{event.outcome}</span>
                          <strong className="text-white">{event.label}</strong>
                        </div>
                        <button className="copy-btn" type="button" onClick={() => void copyEventOutput(event)}>
                          <Copy className="w-4 h-4" /> Copy
                        </button>
                      </header>

                      <div className="timeline-meta">
                        <span>
                          <Clock3 className="w-4 h-4" /> Started {formatTimestamp(event.startedAt)}
                        </span>
                        <span>Duration {formatDuration(event.durationMs)}</span>
                      </div>

                      <p className="text-white/80">{event.note}</p>

                      <details>
                        <summary className="cursor-pointer text-white/85">STDOUT</summary>
                        <pre className="terminal-window p-4 mt-2 whitespace-pre-wrap">{event.stdout || "(stdout empty)"}</pre>
                      </details>

                      <details>
                        <summary className="cursor-pointer text-white/85">STDERR</summary>
                        <pre className="terminal-window p-4 mt-2 whitespace-pre-wrap">{event.stderr || "(stderr empty)"}</pre>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
