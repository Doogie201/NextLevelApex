"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  ListChecks,
  Loader2,
  Play,
  Search,
  Shield,
  TerminalSquare,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CommandId } from "@/engine/commandContract";
import { loadCommandHistory, storeCommandHistory } from "@/engine/historyStore";
import {
  classifyCommandOutcome,
  formatCommandLabel,
  healthBadgeFromDiagnose,
  isStale,
  summarizeCommandResult,
  type CommandErrorType,
  type CommandEvent,
  type CommandOutcome,
  type CommandResponse,
  type DiagnoseSummary,
  type HealthBadge,
  type TaskResult,
} from "@/engine/viewModel";

type ViewId = "dashboard" | "tasks" | "output";
type SeverityFilter = "ALL" | CommandOutcome;

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
    taskNames: Array.isArray(raw.taskNames)
      ? (raw.taskNames.filter((entry) => typeof entry === "string") as string[])
      : [],
    taskResults: Array.isArray(raw.taskResults) ? (raw.taskResults as TaskResult[]) : [],
    diagnose:
      typeof raw.diagnose === "object" && raw.diagnose !== null
        ? (raw.diagnose as CommandResponse["diagnose"])
        : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
    httpStatus,
  };
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
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [activeCommandLabel, setActiveCommandLabel] = useState<string>("");
  const [friendlyMessage, setFriendlyMessage] = useState("Run diagnose to evaluate stack health.");
  const [lastUpdatedAtIso, setLastUpdatedAtIso] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const abortControllerRef = useRef<AbortController | null>(null);

  const badgeClass = useMemo(() => {
    if (healthBadge === "OK") {
      return "badge-PASS";
    }
    if (healthBadge === "DEGRADED") {
      return "badge-PENDING";
    }
    return "badge-FAIL";
  }, [healthBadge]);

  const isStaleState = useMemo(() => isStale(lastUpdatedAtIso, nowTick), [lastUpdatedAtIso, nowTick]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 60_000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const view = new URLSearchParams(window.location.search).get("view");
    if (view === "dashboard" || view === "tasks" || view === "output") {
      setActiveView(view);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const loaded = loadCommandHistory(window.localStorage);
    setCommandHistory(loaded);
    if (loaded.length > 0) {
      setSelectedEventId(loaded[0]?.id ?? null);
      setLastUpdatedAtIso(loaded[0]?.finishedAt ?? loaded[0]?.startedAt ?? null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    storeCommandHistory(window.localStorage, commandHistory);
  }, [commandHistory]);

  useEffect(() => {
    if (commandHistory.length === 0) {
      setSelectedEventId(null);
      return;
    }
    if (!selectedEventId || !commandHistory.some((entry) => entry.id === selectedEventId)) {
      setSelectedEventId(commandHistory[0]?.id ?? null);
    }
  }, [commandHistory, selectedEventId]);

  const callNlx = useCallback(
    async (commandId: CommandId, taskName?: string, signal?: AbortSignal): Promise<CommandResponse> => {
      try {
        const response = await fetch("/api/nlx/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ commandId, taskName }),
          signal,
        });

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        return normalizeCommandResponse(commandId, response.status, payload);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return {
            ok: false,
            commandId,
            exitCode: 130,
            timedOut: false,
            errorType: "aborted",
            stdout: "",
            stderr: "Command canceled by user.",
            error: "Command canceled by user.",
            httpStatus: 499,
          };
        }

        const message = error instanceof Error ? error.message : "Unexpected command execution error.";
        return {
          ok: false,
          commandId,
          exitCode: 1,
          timedOut: false,
          errorType: "spawn_error",
          stdout: "",
          stderr: message,
          error: message,
          httpStatus: 500,
        };
      }
    },
    [],
  );

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
        taskResults: [],
      },
      ...previous,
    ]);

    setSelectedEventId(eventId);
    return eventId;
  }, []);

  const finalizeCommand = useCallback((eventId: string, startedAtMs: number, result: CommandResponse): void => {
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
          taskResults: result.taskResults ?? [],
        };
      }),
    );
    setLastUpdatedAtIso(finishedAt);
  }, []);

  const executeCommand = useCallback(
    async (commandId: CommandId, taskName?: string): Promise<CommandResponse> => {
      const label = formatCommandLabel(commandId, taskName);
      setActiveCommandLabel(label);

      const eventId = appendCommandStart(commandId, label);
      const startedAtMs = Date.now();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const result = await callNlx(commandId, taskName, controller.signal);

      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }

      finalizeCommand(eventId, startedAtMs, result);
      setActiveCommandLabel("");
      return result;
    },
    [appendCommandStart, callNlx, finalizeCommand],
  );

  const cancelRunningCommand = useCallback((): void => {
    abortControllerRef.current?.abort();
    setFriendlyMessage("Cancel requested. Waiting for command shutdown...");
  }, []);

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
      setHealthBadge(healthBadgeFromDiagnose(result));

      if (!result.ok) {
        setFriendlyMessage(summarizeCommandResult(result));
        return;
      }

      if (!result.diagnose) {
        setFriendlyMessage("Diagnose output was missing required fields.");
        return;
      }

      setDiagnoseSummary(result.diagnose.summary);
      setFriendlyMessage(
        result.diagnose.badge === "OK"
          ? "DNS stack appears healthy and private."
          : "DNS stack is degraded. Review inspector notes and output timeline.",
      );
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

        if (result.errorType === "aborted") {
          aggregated.push({
            taskName,
            status: "FAIL",
            reason: "Execution canceled by user.",
          });
          setFriendlyMessage("Task run canceled by user.");
          break;
        }

        if (result.taskResults && result.taskResults.length > 0) {
          aggregated.push(...result.taskResults);
        } else {
          aggregated.push({
            taskName,
            status: result.ok ? "UNKNOWN" : "FAIL",
            reason: summarizeCommandResult(result),
          });
        }
      }

      setTaskResults(aggregated);
      if (aggregated.length > 0) {
        setFriendlyMessage("Selected task dry-run complete.");
      }
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

  const filteredHistory = useMemo(() => {
    return commandHistory.filter((event) => {
      if (severityFilter !== "ALL" && event.outcome !== severityFilter) {
        return false;
      }

      if (!searchQuery.trim()) {
        return true;
      }

      const needle = searchQuery.toLowerCase();
      const haystacks = [
        event.label,
        event.note,
        event.stdout,
        event.stderr,
        ...event.taskResults.map((task) => `${task.taskName} ${task.status} ${task.reason}`),
      ];

      return haystacks.some((value) => value.toLowerCase().includes(needle));
    });
  }, [commandHistory, searchQuery, severityFilter]);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) {
      return filteredHistory[0] ?? null;
    }
    return filteredHistory.find((event) => event.id === selectedEventId) ?? filteredHistory[0] ?? null;
  }, [filteredHistory, selectedEventId]);

  useEffect(() => {
    void (async () => {
      try {
        await loadConfig();
        await loadTasks();
        await runDiagnose();
      } catch {
        setFriendlyMessage("Failed to initialize dashboard diagnostics.");
      }
    })();
  }, [loadConfig, loadTasks, runDiagnose]);

  return (
    <div className="meta-root" data-theme="run">
      <div className="aurora-background" aria-hidden="true" />
      <main className="meta-shell">
        <header className="glass-card top-healthbar" aria-live="polite">
          <div className="health-title-row">
            <div>
              <p className="eyebrow">NextLevelApex Control Plane</p>
              <h1 className="meta-title">Local DNS + Orchestrator Observatory</h1>
            </div>
            <div className="read-only-badge" title="Read-only mode is server enforced">
              <Shield className="w-4 h-4" /> READ-ONLY {readOnly ? "ON" : "OFF"}
            </div>
          </div>

          <div className="health-meta-row">
            <span className={`badge-status ${badgeClass}`}>
              {healthBadge === "OK" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {healthBadge}
            </span>
            <span className={`stale-chip ${isStaleState ? "stale-on" : "stale-off"}`}>
              {isStaleState ? "STALE" : "FRESH"}
            </span>
            <span className="meta-muted">
              Last updated: {lastUpdatedAtIso ? formatTimestamp(lastUpdatedAtIso) : "never"}
            </span>
          </div>

          <div className="health-actions">
            <button className="btn-theme" onClick={() => void runDiagnose()} disabled={isBusy}>
              <Activity className="w-4 h-4" /> Run Diagnose
            </button>
            <button className="btn-theme" onClick={() => void runDryRunSweep()} disabled={isBusy}>
              <Play className="w-4 h-4" /> Run Dry-Run Sweep
            </button>
            {isBusy && (
              <button className="btn-muted" onClick={cancelRunningCommand} type="button">
                <X className="w-4 h-4" /> Cancel {activeCommandLabel || "Run"}
              </button>
            )}
          </div>

          <p className="meta-muted">{friendlyMessage}</p>
        </header>

        <aside className="glass-card left-nav" aria-label="Navigation">
          <button
            type="button"
            className={`nav-item ${activeView === "dashboard" ? "nav-item-active" : ""}`}
            onClick={() => setActiveView("dashboard")}
          >
            <Activity className="w-4 h-4" /> Dashboard
          </button>
          <button
            type="button"
            className={`nav-item ${activeView === "tasks" ? "nav-item-active" : ""}`}
            onClick={() => setActiveView("tasks")}
          >
            <ListChecks className="w-4 h-4" /> Tasks
          </button>
          <button
            type="button"
            className={`nav-item ${activeView === "output" ? "nav-item-active" : ""}`}
            onClick={() => setActiveView("output")}
          >
            <TerminalSquare className="w-4 h-4" /> Output
          </button>
        </aside>

        <section className="main-content" aria-label="Main content">
          <AnimatePresence mode="wait">
            {activeView === "dashboard" && (
              <motion.div
                key="dashboard"
                className="glass-card content-card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22 }}
              >
                <h2 className="section-title">Stack Overview</h2>
                {diagnoseSummary ? (
                  <div className="diagnose-grid">
                    <div className="diagnose-tile">
                      <span>DNS Mode</span>
                      <strong>{diagnoseSummary.dnsMode}</strong>
                    </div>
                    <div className="diagnose-tile">
                      <span>Resolver</span>
                      <strong>{diagnoseSummary.resolver}</strong>
                    </div>
                    <div className="diagnose-tile">
                      <span>Pi-hole</span>
                      <strong>{diagnoseSummary.pihole}</strong>
                    </div>
                    <div className="diagnose-tile">
                      <span>Cloudflared</span>
                      <strong>{diagnoseSummary.cloudflared}</strong>
                    </div>
                    <div className="diagnose-tile">
                      <span>Pi-hole Upstream</span>
                      <strong>{diagnoseSummary.piholeUpstream}</strong>
                    </div>
                    <div className="diagnose-tile">
                      <span>Plaintext DNS</span>
                      <strong>{diagnoseSummary.plaintextDns}</strong>
                    </div>
                  </div>
                ) : (
                  <p className="meta-muted">No diagnose output available yet.</p>
                )}
              </motion.div>
            )}

            {activeView === "tasks" && (
              <motion.div
                key="tasks"
                className="glass-card content-card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22 }}
              >
                <h2 className="section-title">Task Dry-Run</h2>
                <p className="meta-muted">Task names are sourced from `nlx list-tasks` and validated server-side.</p>

                <div className="task-controls">
                  <button className="btn-muted" onClick={() => void loadTasks()} disabled={isBusy}>
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

                <div className="task-grid">
                  {knownTasks.map((task) => (
                    <label key={task} className="task-option">
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
                      <span>{task}</span>
                    </label>
                  ))}
                </div>

                <div className="task-table-wrap">
                  <table className="task-table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Status</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taskResults.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="empty-cell">
                            No task output yet.
                          </td>
                        </tr>
                      ) : (
                        taskResults.map((result) => (
                          <tr key={`${result.taskName}-${result.status}-${result.reason}`}>
                            <td>{result.taskName}</td>
                            <td>
                              <span className={`status-pill ${statusClass(result.status)}`}>{result.status}</span>
                            </td>
                            <td>{result.reason}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeView === "output" && (
              <motion.div
                key="output"
                className="glass-card content-card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22 }}
              >
                <h2 className="section-title">Live Output Viewer</h2>
                <p className="meta-muted">Filter timeline entries and inspect redacted stdout/stderr per command.</p>

                <div className="output-controls">
                  <label className="search-control">
                    <Search className="w-4 h-4" />
                    <input
                      type="search"
                      placeholder="Search output"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </label>
                  <label className="select-control">
                    <span>Severity</span>
                    <select
                      value={severityFilter}
                      onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                    >
                      <option value="ALL">All</option>
                      <option value="PASS">PASS</option>
                      <option value="WARN">WARN</option>
                      <option value="FAIL">FAIL</option>
                      <option value="RUNNING">RUNNING</option>
                    </select>
                  </label>
                </div>

                {filteredHistory.length === 0 ? (
                  <p className="meta-muted">No output entries for the selected filter.</p>
                ) : (
                  <div className="timeline-list" role="list" aria-label="Command timeline">
                    {filteredHistory.map((event) => (
                      <article
                        key={event.id}
                        className={`timeline-item ${selectedEvent?.id === event.id ? "timeline-item-active" : ""}`}
                        role="listitem"
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        <header className="timeline-header">
                          <div className="timeline-heading">
                            <span className={`status-pill ${statusClass(event.outcome)}`}>{event.outcome}</span>
                            <strong>{event.label}</strong>
                          </div>
                          <button className="copy-btn" type="button" onClick={() => void copyEventOutput(event)}>
                            <Copy className="w-4 h-4" /> Copy
                          </button>
                        </header>

                        <div className="timeline-meta">
                          <span>
                            <Clock3 className="w-4 h-4" /> {formatTimestamp(event.startedAt)}
                          </span>
                          <span>Duration {formatDuration(event.durationMs)}</span>
                        </div>

                        <p className="timeline-note">{event.note}</p>

                        {event.taskResults.length > 0 && (
                          <ol className="stepper-list">
                            {event.taskResults.map((step) => (
                              <li key={`${event.id}-${step.taskName}-${step.status}-${step.reason}`}>
                                <span className={`status-pill ${statusClass(step.status)}`}>{step.status}</span>
                                <div>
                                  <strong>{step.taskName}</strong>
                                  <p>{step.reason}</p>
                                </div>
                              </li>
                            ))}
                          </ol>
                        )}

                        <details open>
                          <summary>STDOUT</summary>
                          <pre className="terminal-window">{event.stdout || "(stdout empty)"}</pre>
                        </details>
                        <details>
                          <summary>STDERR</summary>
                          <pre className="terminal-window">{event.stderr || "(stderr empty)"}</pre>
                        </details>
                      </article>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <aside className="glass-card inspector-panel" aria-label="Inspector">
          <h2 className="section-title">Inspector</h2>
          {isBusy ? (
            <div className="inspector-live">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Running: {activeCommandLabel || "Command"}</span>
            </div>
          ) : (
            <p className="meta-muted">Idle</p>
          )}

          <dl className="inspector-grid">
            <div>
              <dt>Known tasks</dt>
              <dd>{knownTasks.length}</dd>
            </div>
            <div>
              <dt>Selected tasks</dt>
              <dd>{selectedTasks.length}</dd>
            </div>
            <div>
              <dt>History entries</dt>
              <dd>{commandHistory.length}</dd>
            </div>
            <div>
              <dt>Filter</dt>
              <dd>{severityFilter}</dd>
            </div>
          </dl>

          {selectedEvent ? (
            <div className="inspector-event">
              <h3>{selectedEvent.label}</h3>
              <p className="meta-muted">{selectedEvent.note}</p>
              <p className="meta-muted">Status: {selectedEvent.outcome}</p>
              <p className="meta-muted">Started: {formatTimestamp(selectedEvent.startedAt)}</p>
              <p className="meta-muted">Duration: {formatDuration(selectedEvent.durationMs)}</p>
            </div>
          ) : (
            <p className="meta-muted">Select a timeline event to inspect details.</p>
          )}
        </aside>
      </main>
    </div>
  );
}
