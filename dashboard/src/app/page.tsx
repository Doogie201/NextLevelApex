"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Play, Shield } from "lucide-react";

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

interface CommandResponse {
  ok: boolean;
  commandId: string;
  exitCode: number;
  timedOut: boolean;
  errorType: string;
  stdout: string;
  stderr: string;
  taskNames?: string[];
  taskResults?: TaskResult[];
  diagnose?: {
    summary: DiagnoseSummary;
    badge: "OK" | "DEGRADED" | "BROKEN";
  };
  error?: string;
}

type BadgeStatus = "OK" | "DEGRADED" | "BROKEN";

function formatNow(): string {
  return new Date().toLocaleString();
}

export default function Home() {
  const [readOnly, setReadOnly] = useState(true);
  const [healthBadge, setHealthBadge] = useState<BadgeStatus>("BROKEN");
  const [diagnoseSummary, setDiagnoseSummary] = useState<DiagnoseSummary | null>(null);
  const [knownTasks, setKnownTasks] = useState<string[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [lastRunAt, setLastRunAt] = useState<string>("never");
  const [isBusy, setIsBusy] = useState(false);
  const [taskResults, setTaskResults] = useState<TaskResult[]>([]);
  const [friendlyMessage, setFriendlyMessage] = useState("Run diagnose to evaluate stack health.");
  const [rawStdout, setRawStdout] = useState("");
  const [rawStderr, setRawStderr] = useState("");

  const badgeClass = useMemo(() => {
    if (healthBadge === "OK") {
      return "badge-PASS";
    }
    if (healthBadge === "DEGRADED") {
      return "badge-PENDING";
    }
    return "badge-FAIL";
  }, [healthBadge]);

  const callNlx = useCallback(async (commandId: string, taskName?: string): Promise<CommandResponse> => {
    const response = await fetch("/api/nlx/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commandId, taskName }),
    });

    const data = (await response.json()) as CommandResponse;

    if (!response.ok) {
      const message = data.error ?? data.stderr ?? `Command '${commandId}' failed.`;
      throw new Error(message);
    }

    return data;
  }, []);

  const loadConfig = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/gui/config", { method: "GET" });
    const payload = (await response.json()) as { readOnly: boolean };
    setReadOnly(payload.readOnly);
  }, []);

  const loadTasks = useCallback(async (): Promise<void> => {
    const result = await callNlx("listTasks");
    const taskNames = result.taskNames ?? [];
    setKnownTasks(taskNames);
    setSelectedTasks((prev) => prev.filter((task) => taskNames.includes(task)));
  }, [callNlx]);

  const runDiagnose = useCallback(async (): Promise<void> => {
    setIsBusy(true);
    setFriendlyMessage("Running diagnose command...");
    try {
      const result = await callNlx("diagnose");
      setRawStdout(result.stdout);
      setRawStderr(result.stderr);

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
          : "DNS stack is degraded. Review notes and dry-run output.",
      );
      setLastRunAt(formatNow());
    } catch (error) {
      setHealthBadge("BROKEN");
      const message = error instanceof Error ? error.message : "Diagnose command failed.";
      setFriendlyMessage(message);
      setRawStderr(message);
      setRawStdout("");
    } finally {
      setIsBusy(false);
    }
  }, [callNlx]);

  const runDryRunSweep = useCallback(async (): Promise<void> => {
    setIsBusy(true);
    setFriendlyMessage("Running full dry-run sweep...");
    try {
      const result = await callNlx("dryRunAll");
      setTaskResults(result.taskResults ?? []);
      setRawStdout(result.stdout);
      setRawStderr(result.stderr);
      setLastRunAt(formatNow());
      setFriendlyMessage("Dry-run sweep complete.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dry-run sweep failed.";
      setFriendlyMessage(message);
      setRawStderr(message);
      setRawStdout("");
    } finally {
      setIsBusy(false);
    }
  }, [callNlx]);

  const runDryRunSelected = useCallback(async (): Promise<void> => {
    if (selectedTasks.length === 0) {
      setFriendlyMessage("Select at least one task first.");
      return;
    }

    setIsBusy(true);
    setFriendlyMessage(`Running dry-run for ${selectedTasks.length} task(s)...`);

    const aggregated: TaskResult[] = [];
    const stdoutBlocks: string[] = [];
    const stderrBlocks: string[] = [];

    try {
      for (const taskName of selectedTasks) {
        const result = await callNlx("dryRunTask", taskName);
        if (result.taskResults && result.taskResults.length > 0) {
          aggregated.push(...result.taskResults);
        } else {
          aggregated.push({
            taskName,
            status: result.ok ? "UNKNOWN" : "FAIL",
            reason: result.ok ? "No task status marker emitted." : "Command did not complete successfully.",
          });
        }
        stdoutBlocks.push(result.stdout);
        if (result.stderr) {
          stderrBlocks.push(result.stderr);
        }
      }

      setTaskResults(aggregated);
      setRawStdout(stdoutBlocks.join("\n\n").trim());
      setRawStderr(stderrBlocks.join("\n\n").trim());
      setLastRunAt(formatNow());
      setFriendlyMessage("Selected task dry-run complete.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Selected task run failed.";
      setFriendlyMessage(message);
      setRawStderr(message);
      setRawStdout(stdoutBlocks.join("\n\n").trim());
    } finally {
      setIsBusy(false);
    }
  }, [callNlx, selectedTasks]);

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
              <p className="text-white/70 mt-1">
                Canonical GUI (v1 read-only) for local diagnose and dry-run observability.
              </p>
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
            <button className="btn-theme" onClick={() => void runDiagnose()} disabled={isBusy}>
              <Activity className="w-4 h-4" /> Run Diagnose
            </button>
            <button className="btn-theme" onClick={() => void runDryRunSweep()} disabled={isBusy}>
              <Play className="w-4 h-4" /> Run Dry-Run Sweep
            </button>
          </div>

          <p className="text-white/80">{friendlyMessage}</p>
          {diagnoseSummary && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-white/85">
              <div><strong>DNS Mode:</strong> {diagnoseSummary.dnsMode}</div>
              <div><strong>Resolver:</strong> {diagnoseSummary.resolver}</div>
              <div><strong>Pi-hole:</strong> {diagnoseSummary.pihole}</div>
              <div><strong>Cloudflared:</strong> {diagnoseSummary.cloudflared}</div>
              <div><strong>Upstream:</strong> {diagnoseSummary.piholeUpstream}</div>
              <div><strong>Plaintext DNS:</strong> {diagnoseSummary.plaintextDns}</div>
            </div>
          )}
        </header>

        <section className="glass-card p-6 flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-white">Run Selected Tasks (Dry-Run Only)</h2>
          <p className="text-white/70">Task names come from <code>nlx list-tasks</code> and are validated server-side.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-auto pr-2">
            {knownTasks.map((task) => (
              <label key={task} className="flex items-center gap-2 text-white/90">
                <input
                  type="checkbox"
                  checked={selectedTasks.includes(task)}
                  onChange={(event) => {
                    setSelectedTasks((prev) =>
                      event.target.checked ? [...prev, task] : prev.filter((entry) => entry !== task),
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
            <button className="btn-theme" onClick={() => void runDryRunSelected()} disabled={isBusy || selectedTasks.length === 0}>
              Run Selected Tasks
            </button>
          </div>
        </section>

        <section className="glass-card p-6 flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-white">Dry-Run Results</h2>
          {taskResults.length === 0 ? (
            <p className="text-white/70">No task output yet.</p>
          ) : (
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
                  {taskResults.map((result) => (
                    <tr key={`${result.taskName}-${result.status}-${result.reason}`} className="border-t border-white/10 align-top">
                      <td className="py-2 pr-3">{result.taskName}</td>
                      <td className="py-2 pr-3">{result.status}</td>
                      <td className="py-2">{result.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details open>
            <summary className="cursor-pointer text-white/85">Raw Output (redacted)</summary>
            <pre className="terminal-window p-4 mt-2 whitespace-pre-wrap">{rawStdout || "(stdout empty)"}</pre>
          </details>
          <details>
            <summary className="cursor-pointer text-white/85">Raw Errors (redacted)</summary>
            <pre className="terminal-window p-4 mt-2 whitespace-pre-wrap">{rawStderr || "(stderr empty)"}</pre>
          </details>
        </section>
      </main>
    </div>
  );
}
