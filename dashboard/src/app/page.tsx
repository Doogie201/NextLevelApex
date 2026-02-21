"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Contrast,
  Copy,
  Download,
  FileJson2,
  Keyboard,
  Link2,
  ListChecks,
  Loader2,
  Pin,
  PinOff,
  Play,
  Search,
  Shield,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { CommandId } from "@/engine/commandContract";
import { isRunEnvelope } from "@/engine/apiContract";
import { localhostWarning } from "@/engine/hostSafety";
import { loadCommandHistory, storeCommandHistory } from "@/engine/historyStore";
import { evaluateShortcut, initialShortcutState, type ShortcutState } from "@/engine/keyboardShortcuts";
import { buildRedactedEventText, buildRedactedLogText } from "@/engine/outputExport";
import {
  nextReducedMotionOverride,
  parseReducedMotionOverride,
  REDUCED_MOTION_STORAGE_KEY,
  resolveReducedMotionEffective,
} from "@/engine/reducedMotion";
import {
  parseUrlState,
  toUrlSearch,
  type UrlInspectorSection,
  type UrlSeverityFilter,
  type UrlViewId,
} from "@/engine/urlState";
import {
  classifyCommandOutcome,
  formatCommandLabel,
  groupTaskResults,
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
import { buildTaskDetailsSummary } from "@/engine/taskDetailsExport";
import { moveTaskSelection, nextVisibleTaskLimit } from "@/engine/taskSelection";
import {
  addRunSession,
  clearRunSessions,
  createRunSessionFromCommandEvent,
  createRunSessionFromResult,
  filterRunSessions,
  loadRunSessions,
  sortRunSessions,
  storeRunSessions,
  togglePinnedSession,
  type RunSession,
  type RunSessionFilter,
  type RunSessionTimeRange,
} from "@/engine/runSessions";
import {
  buildSessionBundleExportJson,
  buildSessionExportJson,
  buildSessionOperatorReport,
} from "@/engine/sessionExport";

type ViewId = UrlViewId;
type SeverityFilter = UrlSeverityFilter;
type InspectorSection = UrlInspectorSection;
interface TaskRowSummary {
  taskName: string;
  status: TaskResult["status"];
  reason: string;
  lastRunAt: string | null;
  outputSnippet: string;
}

const TASK_VISIBLE_STEP = 200;

function taskRowId(taskName: string): string {
  return `task-row-${encodeURIComponent(taskName)}`;
}

function isTypingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest("[contenteditable='true']"));
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
  if (!isRunEnvelope(payload)) {
    const fallbackError =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Unexpected response payload (HTTP ${httpStatus}).`;
    return {
      ok: false,
      commandId,
      badge: "BROKEN",
      reasonCode: "UNKNOWN",
      exitCode: 1,
      timedOut: false,
      errorType: "spawn_error",
      stdout: "",
      stderr: fallbackError,
      events: [],
      redacted: false,
      error: fallbackError,
      httpStatus,
    };
  }

  const reasonToErrorType = (): CommandErrorType => {
    if (payload.errorType && typeof payload.errorType === "string") {
      return payload.errorType as CommandErrorType;
    }
    if (payload.reasonCode === "TIMEOUT") {
      return "timeout";
    }
    return "spawn_error";
  };

  return {
    ok: payload.ok,
    commandId,
    badge: payload.badge,
    reasonCode: payload.reasonCode,
    exitCode: typeof payload.exitCode === "number" ? payload.exitCode : payload.ok ? 0 : 1,
    timedOut: payload.timedOut === true || payload.reasonCode === "TIMEOUT",
    errorType: reasonToErrorType(),
    stdout: payload.stdout,
    stderr: payload.stderr,
    events: payload.events,
    redacted: payload.redacted,
    taskNames: Array.isArray(payload.taskNames)
      ? (payload.taskNames.filter((entry) => typeof entry === "string") as string[])
      : [],
    taskResults: payload.taskResults ?? [],
    diagnose: payload.diagnose,
    error: payload.ok ? undefined : payload.stderr || `${payload.reasonCode} (${httpStatus})`,
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
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [taskVisibleLimit, setTaskVisibleLimit] = useState(TASK_VISIBLE_STEP);
  const [taskResults, setTaskResults] = useState<TaskResult[]>([]);
  const [commandHistory, setCommandHistory] = useState<CommandEvent[]>([]);
  const [runSessions, setRunSessions] = useState<RunSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [inspectorSection, setInspectorSection] = useState<InspectorSection>("summary");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sessionCommandFilter, setSessionCommandFilter] = useState<"ALL" | CommandId>("ALL");
  const [sessionBadgeFilter, setSessionBadgeFilter] = useState<"ALL" | HealthBadge>("ALL");
  const [sessionTimeRange, setSessionTimeRange] = useState<RunSessionTimeRange>("all");
  const [sessionDegradedOnly, setSessionDegradedOnly] = useState(false);
  const [sessionsPanelOpen, setSessionsPanelOpen] = useState(true);
  const [highContrast, setHighContrast] = useState(false);
  const [reduceMotionOverride, setReduceMotionOverride] = useState<boolean | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isUrlStateReady, setIsUrlStateReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutState, setShortcutState] = useState<ShortcutState>(() => initialShortcutState());
  const [liveMessage, setLiveMessage] = useState("Ready.");
  const [activeCommandLabel, setActiveCommandLabel] = useState<string>("");
  const [activeElapsedMs, setActiveElapsedMs] = useState(0);
  const [friendlyMessage, setFriendlyMessage] = useState("Run diagnose to evaluate stack health.");
  const [hostWarningMessage, setHostWarningMessage] = useState<string | null>(null);
  const [lastUpdatedAtIso, setLastUpdatedAtIso] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeStartedAtRef = useRef<number | null>(null);
  const runStatusRef = useRef<HTMLSpanElement | null>(null);
  const healthBadgeRef = useRef<HTMLSpanElement | null>(null);
  const outputHeaderRef = useRef<HTMLElement | null>(null);
  const outputSearchInputRef = useRef<HTMLInputElement | null>(null);
  const sessionsListRef = useRef<HTMLDivElement | null>(null);
  const tasksSearchInputRef = useRef<HTMLInputElement | null>(null);
  const shortcutCloseRef = useRef<HTMLButtonElement | null>(null);
  const shortcutDialogRef = useRef<HTMLDivElement | null>(null);
  const shortcutOpenerRef = useRef<HTMLElement | null>(null);

  const effectiveReducedMotion = useMemo(
    () => resolveReducedMotionEffective(reduceMotionOverride, prefersReducedMotion),
    [prefersReducedMotion, reduceMotionOverride],
  );

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
    const parsed = parseUrlState(window.location.search);
    setActiveView(parsed.view);
    setSelectedEventId(parsed.eventId);
    setSelectedSessionId(parsed.sessionId);
    setSeverityFilter(parsed.severity);
    setInspectorSection(parsed.inspectorSection);
    setSearchQuery(parsed.q);
    setIsUrlStateReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedContrast = window.localStorage.getItem("nlx.gui.highContrast");
    setHighContrast(storedContrast === "true");
    setReduceMotionOverride(parseReducedMotionOverride(window.localStorage.getItem(REDUCED_MOTION_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = (): void => setPrefersReducedMotion(mediaQuery.matches);
    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);
    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setHostWarningMessage(localhostWarning(window.location.hostname));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("nlx.gui.highContrast", highContrast ? "true" : "false");
  }, [highContrast]);

  useEffect(() => {
    if (typeof window === "undefined" || reduceMotionOverride === null) {
      return;
    }
    window.localStorage.setItem(REDUCED_MOTION_STORAGE_KEY, reduceMotionOverride ? "true" : "false");
  }, [reduceMotionOverride]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const loaded = loadCommandHistory(window.localStorage);
    setCommandHistory(loaded);

    const loadedSessions = loadRunSessions(window.localStorage);
    if (loadedSessions.length > 0) {
      setRunSessions(sortRunSessions(loadedSessions));
    } else if (loaded.length > 0) {
      const derivedSessions = sortRunSessions(
        loaded.filter((event) => event.outcome !== "RUNNING").map((event) => createRunSessionFromCommandEvent(event)),
      );
      setRunSessions(derivedSessions);
    }

    if (loaded.length > 0) {
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
    if (typeof window === "undefined") {
      return;
    }
    storeRunSessions(window.localStorage, runSessions);
  }, [runSessions]);

  useEffect(() => {
    if (!isBusy || activeStartedAtRef.current === null) {
      setActiveElapsedMs(0);
      return;
    }

    const tick = (): void => {
      setActiveElapsedMs(Date.now() - activeStartedAtRef.current!);
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [isBusy]);

  useEffect(() => {
    if (typeof window === "undefined" || !isUrlStateReady) {
      return;
    }
    const nextSearch = toUrlSearch({
      view: activeView,
      eventId: selectedEventId,
      sessionId: selectedSessionId,
      severity: severityFilter,
      inspectorSection,
      q: searchQuery,
    });
    const nextQuery = nextSearch.length > 0 ? `?${nextSearch}` : "";
    if (window.location.search !== nextQuery) {
      window.history.replaceState(null, "", `${window.location.pathname}${nextQuery}`);
    }
  }, [
    activeView,
    inspectorSection,
    isUrlStateReady,
    searchQuery,
    selectedEventId,
    selectedSessionId,
    severityFilter,
  ]);

  useEffect(() => {
    if (commandHistory.length === 0) {
      setSelectedEventId(null);
      return;
    }
    if (!selectedEventId || !commandHistory.some((entry) => entry.id === selectedEventId)) {
      setSelectedEventId(commandHistory[0]?.id ?? null);
    }
  }, [commandHistory, selectedEventId]);

  useEffect(() => {
    if (!selectedEventId) {
      return;
    }
    const matchingSession = runSessions.find((session) => session.eventId === selectedEventId);
    if (matchingSession && matchingSession.id !== selectedSessionId) {
      setSelectedSessionId(matchingSession.id);
    }
  }, [runSessions, selectedEventId, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    const session = runSessions.find((item) => item.id === selectedSessionId);
    if (!session) {
      return;
    }
    if (selectedEventId !== session.eventId) {
      setSelectedEventId(session.eventId);
    }
  }, [runSessions, selectedEventId, selectedSessionId]);

  const setViewByShortcut = useCallback((viewId: ViewId): void => {
    setActiveView(viewId);
    setLiveMessage(`Switched to ${viewId} view.`);
  }, []);

  const openKeyboardShortcuts = useCallback((): void => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      shortcutOpenerRef.current = document.activeElement;
    }
    setShortcutsOpen(true);
    setLiveMessage("Keyboard shortcuts opened.");
  }, []);

  const closeKeyboardShortcuts = useCallback((): void => {
    setShortcutsOpen(false);
    setLiveMessage("Keyboard shortcuts closed.");
    shortcutOpenerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!shortcutsOpen) {
      return;
    }
    shortcutCloseRef.current?.focus();
  }, [shortcutsOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const result = evaluateShortcut(shortcutState, {
        key: event.key,
        nowMs: Date.now(),
        isTypingTarget: isTypingElement(event.target),
        isOutputView: activeView === "output",
        hasSearchInput: Boolean(outputSearchInputRef.current),
        isHelpOpen: shortcutsOpen,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
      });

      setShortcutState(result.nextState);

      if (!result.action) {
        return;
      }

      if (result.action === "OPEN_HELP") {
        event.preventDefault();
        openKeyboardShortcuts();
        return;
      }

      if (result.action === "CLOSE_HELP") {
        event.preventDefault();
        closeKeyboardShortcuts();
        return;
      }

      if (result.action === "FOCUS_SEARCH") {
        event.preventDefault();
        outputSearchInputRef.current?.focus();
        outputSearchInputRef.current?.select();
        return;
      }

      event.preventDefault();
      if (result.action === "VIEW_DASHBOARD") {
        setViewByShortcut("dashboard");
      } else if (result.action === "VIEW_TASKS") {
        setViewByShortcut("tasks");
      } else if (result.action === "VIEW_OUTPUT") {
        setViewByShortcut("output");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeView, closeKeyboardShortcuts, openKeyboardShortcuts, setViewByShortcut, shortcutState, shortcutsOpen]);

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

  const finalizeCommand = useCallback(
    (
      eventId: string,
      finishedAt: string,
      durationMs: number,
      outcome: CommandOutcome,
      note: string,
      result: CommandResponse,
    ): void => {
    setCommandHistory((previous) =>
      previous.map((entry) => {
        if (entry.id !== eventId) {
          return entry;
        }
        return {
          ...entry,
          finishedAt,
          durationMs,
          outcome,
          note,
          stdout: result.stdout,
          stderr: result.stderr,
          taskResults: result.taskResults ?? [],
        };
      }),
    );
    setLastUpdatedAtIso(finishedAt);
    },
    [],
  );

  const executeCommand = useCallback(
    async (commandId: CommandId, taskName?: string): Promise<CommandResponse> => {
      const label = formatCommandLabel(commandId, taskName);
      setActiveCommandLabel(label);
      setCancelRequested(false);
      setLiveMessage(`Running ${label}...`);
      requestAnimationFrame(() => {
        runStatusRef.current?.focus();
      });

      const eventId = appendCommandStart(commandId, label);
      const startedAtMs = Date.now();
      activeStartedAtRef.current = startedAtMs;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const result = await callNlx(commandId, taskName, controller.signal);

      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }

      const finishedAtIso = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - startedAtMs);
      const outcome = classifyCommandOutcome(result);
      const note = summarizeCommandResult(result);

      finalizeCommand(eventId, finishedAtIso, durationMs, outcome, note, result);
      setRunSessions((previous) =>
        addRunSession(
          previous,
          createRunSessionFromResult({
            eventId,
            commandId,
            taskName,
            label,
            note,
            startedAtMs,
            finishedAtIso,
            durationMs,
            result,
          }),
        ),
      );
      setActiveCommandLabel("");
      activeStartedAtRef.current = null;
      if (result.errorType === "aborted") {
        setLiveMessage("Cancelled.");
        setFriendlyMessage("Cancel confirmed. Command stopped safely.");
      } else if (!result.ok) {
        setLiveMessage(`Run failed: ${result.reasonCode ?? "UNKNOWN"}.`);
      } else {
        setLiveMessage(`Completed: ${result.badge ?? "OK"}.`);
      }

      if (!isTypingElement(typeof document !== "undefined" ? document.activeElement : null)) {
        requestAnimationFrame(() => {
          if (activeView === "output") {
            outputHeaderRef.current?.focus();
          } else {
            healthBadgeRef.current?.focus();
          }
        });
      }
      return result;
    },
    [activeView, appendCommandStart, callNlx, finalizeCommand],
  );

  const cancelRunningCommand = useCallback((): void => {
    abortControllerRef.current?.abort();
    setCancelRequested(true);
    setLiveMessage("Cancel requested.");
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

  const runDryRunSelected = useCallback(async (tasksOverride?: string[]): Promise<void> => {
    const tasksToRun = tasksOverride ?? selectedTasks;
    if (tasksToRun.length === 0) {
      setFriendlyMessage("Select at least one task first.");
      return;
    }

    setActiveView("output");
    setIsBusy(true);
    setFriendlyMessage(`Running dry-run for ${tasksToRun.length} task(s)...`);

    const aggregated: TaskResult[] = [];

    try {
      for (const taskName of tasksToRun) {
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
    const payload = buildRedactedEventText(event);

    try {
      await navigator.clipboard.writeText(payload);
      setFriendlyMessage(`Copied redacted output for ${event.label}.`);
    } catch {
      setFriendlyMessage("Clipboard write failed in this browser context.");
    }
  }, []);

  const downloadRedactedLog = useCallback((events: CommandEvent[]): void => {
    if (typeof window === "undefined") {
      return;
    }

    const payload = buildRedactedLogText(events);
    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    anchor.href = url;
    anchor.download = `nlx-redacted-log-${timestamp}.txt`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    setFriendlyMessage("Downloaded redacted log.");
  }, []);

  const copySelectedTaskDetails = useCallback(async (task: TaskRowSummary): Promise<void> => {
    const payload = buildTaskDetailsSummary({
      taskName: task.taskName,
      status: task.status,
      reason: task.reason,
      lastRunAt: task.lastRunAt,
      outputSnippet: task.outputSnippet,
    });

    try {
      await navigator.clipboard.writeText(payload);
      setFriendlyMessage(`Copied redacted task details for ${task.taskName}.`);
    } catch {
      setFriendlyMessage("Clipboard write failed in this browser context.");
    }
  }, []);

  const handleTaskSelectionToggle = useCallback((taskName: string, checked: boolean): void => {
    setSelectedTasks((previous) =>
      checked ? [...new Set([...previous, taskName])] : previous.filter((entry) => entry !== taskName),
    );
  }, []);

  const handleRunSelectedFromKeyboard = useCallback((): void => {
    if (isBusy) {
      return;
    }

    const fallbackTask = selectedTaskName ? [selectedTaskName] : [];
    const tasksToRun = selectedTasks.length > 0 ? selectedTasks : fallbackTask;
    if (tasksToRun.length === 0) {
      setFriendlyMessage("Select at least one task first.");
      return;
    }

    if (selectedTasks.length === 0 && fallbackTask.length === 1) {
      setSelectedTasks([fallbackTask[0]]);
    }

    void runDryRunSelected(tasksToRun);
  }, [isBusy, runDryRunSelected, selectedTaskName, selectedTasks]);

  const clearTaskSelection = useCallback((): void => {
    setSelectedTaskName(null);
    setLiveMessage("Task selection cleared.");
  }, []);

  const focusTaskSearch = useCallback((): void => {
    tasksSearchInputRef.current?.focus();
    tasksSearchInputRef.current?.select();
  }, []);

  const copyCurrentDeepLink = useCallback(async (): Promise<void> => {
    if (typeof window === "undefined") {
      return;
    }

    const search = toUrlSearch({
      view: activeView,
      eventId: selectedEventId,
      sessionId: selectedSessionId,
      severity: severityFilter,
      inspectorSection,
      q: searchQuery,
    });
    const deepLink = `${window.location.origin}${window.location.pathname}${search.length > 0 ? `?${search}` : ""}`;

    try {
      await navigator.clipboard.writeText(deepLink);
      setFriendlyMessage("Copied deep link to current view and filters.");
    } catch {
      setFriendlyMessage("Clipboard write failed in this browser context.");
    }
  }, [activeView, inspectorSection, searchQuery, selectedEventId, selectedSessionId, severityFilter]);

  const handleShortcutDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeKeyboardShortcuts();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const container = shortcutDialogRef.current;
      if (!container) {
        return;
      }

      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );

      if (focusables.length === 0) {
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    },
    [closeKeyboardShortcuts],
  );

  const motionTransition = useMemo(
    () => (effectiveReducedMotion ? { duration: 0 } : { duration: 0.22 }),
    [effectiveReducedMotion],
  );
  const motionInitial = useMemo(
    () => (effectiveReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }),
    [effectiveReducedMotion],
  );
  const motionExit = useMemo(
    () => (effectiveReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -12 }),
    [effectiveReducedMotion],
  );

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

  const selectedEventGroups = useMemo(() => {
    if (!selectedEvent || selectedEvent.taskResults.length === 0) {
      return { bySeverity: [], byTask: [] };
    }
    return groupTaskResults(selectedEvent.taskResults);
  }, [selectedEvent]);

  const sessionFilter = useMemo<RunSessionFilter>(
    () => ({
      commandId: sessionCommandFilter,
      badge: sessionBadgeFilter,
      degradedOnly: sessionDegradedOnly,
      timeRange: sessionTimeRange,
    }),
    [sessionBadgeFilter, sessionCommandFilter, sessionDegradedOnly, sessionTimeRange],
  );

  const filteredSessions = useMemo(
    () => filterRunSessions(sortRunSessions(runSessions), sessionFilter),
    [runSessions, sessionFilter],
  );

  const sessionCommandOptions = useMemo(
    () => Array.from(new Set(runSessions.map((session) => session.commandId))).sort(),
    [runSessions],
  );

  const selectedSession = useMemo(() => {
    if (!selectedSessionId) {
      return filteredSessions[0] ?? null;
    }
    return filteredSessions.find((session) => session.id === selectedSessionId) ?? null;
  }, [filteredSessions, selectedSessionId]);

  const selectedSessionTaskGroups = useMemo(() => {
    if (!selectedSession || selectedSession.taskResults.length === 0) {
      return { bySeverity: [], byTask: [] };
    }
    return groupTaskResults(selectedSession.taskResults);
  }, [selectedSession]);

  useEffect(() => {
    if (filteredSessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    if (!selectedSessionId || !filteredSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(filteredSessions[0].id);
    }
  }, [filteredSessions, selectedSessionId]);

  const openSession = useCallback((sessionId: string): void => {
    const session = filteredSessions.find((item) => item.id === sessionId) ?? runSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    setActiveView("output");
    setSessionsPanelOpen(true);
    setSelectedSessionId(session.id);
    setSelectedEventId(session.eventId);
    setInspectorSection("summary");
    setLiveMessage(`Opened session ${session.label}.`);
  }, [filteredSessions, runSessions]);

  const toggleSessionPinned = useCallback((sessionId: string): void => {
    setRunSessions((previous) => togglePinnedSession(previous, sessionId));
  }, []);

  const clearSessionHistoryWithConfirm = useCallback((): void => {
    if (typeof window === "undefined") {
      return;
    }
    if (!window.confirm("Clear all stored run sessions? This cannot be undone.")) {
      return;
    }
    setRunSessions(clearRunSessions());
    setSelectedSessionId(null);
    setInspectorSection("summary");
    setLiveMessage("Run session history cleared.");
    setFriendlyMessage("Cleared stored run sessions.");
  }, []);

  const downloadTextPayload = useCallback((fileName: string, payload: string): void => {
    if (typeof window === "undefined") {
      return;
    }
    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const exportSelectedSessionJson = useCallback((): void => {
    if (!selectedSession) {
      return;
    }
    const timestamp = new Date(selectedSession.finishedAt).toISOString().replace(/[:]/g, "-");
    downloadTextPayload(`nlx-session-${selectedSession.id}-${timestamp}.json`, buildSessionExportJson(selectedSession));
    setFriendlyMessage("Exported selected session JSON (redacted).");
  }, [downloadTextPayload, selectedSession]);

  const exportSelectedSessionReport = useCallback((): void => {
    if (!selectedSession) {
      return;
    }
    const timestamp = new Date(selectedSession.finishedAt).toISOString().replace(/[:]/g, "-");
    downloadTextPayload(
      `nlx-session-report-${selectedSession.id}-${timestamp}.txt`,
      buildSessionOperatorReport(selectedSession),
    );
    setFriendlyMessage("Exported selected operator report (redacted).");
  }, [downloadTextPayload, selectedSession]);

  const exportSessionBundle = useCallback((): void => {
    const source = filteredSessions.length > 0 ? filteredSessions : runSessions;
    if (source.length === 0) {
      setFriendlyMessage("No sessions available to export.");
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    downloadTextPayload(`nlx-session-bundle-${timestamp}.json`, buildSessionBundleExportJson(source));
    setFriendlyMessage("Exported filtered session bundle JSON (redacted).");
  }, [downloadTextPayload, filteredSessions, runSessions]);

  const taskRows = useMemo<TaskRowSummary[]>(() => {
    const latest = new Map<string, TaskRowSummary>();

    for (const event of commandHistory) {
      for (const taskResult of event.taskResults) {
        if (latest.has(taskResult.taskName)) {
          continue;
        }

        const snippetSource = (event.stderr || event.stdout || event.note || "").trim();
        latest.set(taskResult.taskName, {
          taskName: taskResult.taskName,
          status: taskResult.status,
          reason: taskResult.reason,
          lastRunAt: event.finishedAt ?? event.startedAt,
          outputSnippet: snippetSource.slice(0, 280),
        });
      }
    }

    return knownTasks.map((taskName) => {
      const existing = latest.get(taskName);
      if (existing) {
        return existing;
      }
      return {
        taskName,
        status: "UNKNOWN",
        reason: "No dry-run result yet.",
        lastRunAt: null,
        outputSnippet: "",
      };
    });
  }, [commandHistory, knownTasks]);

  const filteredTaskRows = useMemo(() => {
    const needle = taskSearchQuery.trim().toLowerCase();
    if (!needle) {
      return taskRows;
    }

    return taskRows.filter(
      (row) => row.taskName.toLowerCase().includes(needle) || row.reason.toLowerCase().includes(needle),
    );
  }, [taskRows, taskSearchQuery]);

  const visibleTaskRows = useMemo(
    () => filteredTaskRows.slice(0, taskVisibleLimit),
    [filteredTaskRows, taskVisibleLimit],
  );

  const selectedTaskRow = useMemo(() => {
    if (!selectedTaskName) {
      return visibleTaskRows[0] ?? filteredTaskRows[0] ?? null;
    }
    return filteredTaskRows.find((row) => row.taskName === selectedTaskName) ?? null;
  }, [filteredTaskRows, selectedTaskName, visibleTaskRows]);

  useEffect(() => {
    setTaskVisibleLimit(TASK_VISIBLE_STEP);
  }, [taskSearchQuery, knownTasks.length]);

  useEffect(() => {
    if (activeView !== "tasks") {
      return;
    }

    if (filteredTaskRows.length === 0) {
      setSelectedTaskName(null);
      return;
    }

    if (!selectedTaskName || !filteredTaskRows.some((row) => row.taskName === selectedTaskName)) {
      setSelectedTaskName(filteredTaskRows[0].taskName);
    }
  }, [activeView, filteredTaskRows, selectedTaskName]);

  useEffect(() => {
    const onTasksKeyDown = (event: KeyboardEvent): void => {
      if (activeView !== "tasks" || shortcutsOpen) {
        return;
      }

      const typingTarget = isTypingElement(event.target);
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;

      if (event.key === "/" && !typingTarget && !hasModifier) {
        event.preventDefault();
        focusTaskSearch();
        return;
      }

      if (event.key === "Escape") {
        if (typingTarget) {
          if (event.target instanceof HTMLElement) {
            event.target.blur();
          }
          setLiveMessage("Task search input blurred.");
          return;
        }

        if (selectedTaskName) {
          event.preventDefault();
          clearTaskSelection();
        }
        return;
      }

      if (typingTarget || hasModifier) {
        return;
      }

      const visibleNames = visibleTaskRows.map((row) => row.taskName);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextTask = moveTaskSelection(
          visibleNames,
          selectedTaskName,
          event.key === "ArrowDown" ? "next" : "prev",
        );
        if (nextTask) {
          setSelectedTaskName(nextTask);
          setLiveMessage(`Selected task ${nextTask}.`);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        handleRunSelectedFromKeyboard();
      }
    };

    window.addEventListener("keydown", onTasksKeyDown);
    return () => window.removeEventListener("keydown", onTasksKeyDown);
  }, [
    activeView,
    clearTaskSelection,
    focusTaskSearch,
    handleRunSelectedFromKeyboard,
    selectedTaskName,
    shortcutsOpen,
    visibleTaskRows,
  ]);

  useEffect(() => {
    const onSessionKeyDown = (event: KeyboardEvent): void => {
      if (activeView !== "output" || shortcutsOpen) {
        return;
      }

      const typingTarget = isTypingElement(event.target);
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;

      if (typingTarget || hasModifier) {
        return;
      }

      if (event.key === "Escape") {
        if (sessionsPanelOpen) {
          event.preventDefault();
          setSessionsPanelOpen(false);
          setLiveMessage("Sessions panel closed.");
        }
        return;
      }

      if (!sessionsPanelOpen || filteredSessions.length === 0) {
        return;
      }

      const ids = filteredSessions.map((session) => session.id);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = selectedSessionId ? ids.indexOf(selectedSessionId) : -1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          currentIndex < 0 ? (delta > 0 ? 0 : ids.length - 1) : (currentIndex + delta + ids.length) % ids.length;
        const nextSessionId = ids[nextIndex];
        if (nextSessionId) {
          setSelectedSessionId(nextSessionId);
          setLiveMessage("Session selection updated.");
          sessionsListRef.current?.focus();
        }
        return;
      }

      if (event.key === "Enter" && selectedSessionId) {
        event.preventDefault();
        openSession(selectedSessionId);
      }
    };

    window.addEventListener("keydown", onSessionKeyDown);
    return () => window.removeEventListener("keydown", onSessionKeyDown);
  }, [activeView, filteredSessions, openSession, selectedSessionId, sessionsPanelOpen, shortcutsOpen]);

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
    <div
      className={`meta-root ${effectiveReducedMotion ? "reduce-motion" : ""}`}
      data-theme="run"
      data-contrast={highContrast ? "high" : "normal"}
    >
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <div className="sr-only" aria-live="polite">
        {liveMessage}
      </div>
      <div className="aurora-background" aria-hidden="true" />
      <div className="meta-shell">
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

          {hostWarningMessage && (
            <div className="host-warning-banner" role="status" aria-live="polite">
              <AlertTriangle className="w-4 h-4" />
              <span>{hostWarningMessage}</span>
            </div>
          )}

          <div className="health-meta-row">
            <span ref={healthBadgeRef} tabIndex={-1} className={`badge-status ${badgeClass}`}>
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
            <button className="btn-theme" onClick={() => void runDiagnose()} disabled={isBusy} aria-label="Run diagnose">
              <Activity className="w-4 h-4" /> Run Diagnose
            </button>
            <button
              className="btn-theme"
              onClick={() => void runDryRunSweep()}
              disabled={isBusy}
              aria-label="Run dry-run sweep"
            >
              <Play className="w-4 h-4" /> Run Dry-Run Sweep
            </button>
            {isBusy && (
              <button className="btn-muted" onClick={cancelRunningCommand} type="button" aria-label="Cancel active command">
                <X className="w-4 h-4" /> Cancel {activeCommandLabel || "Run"}
              </button>
            )}
            <button
              className="btn-muted"
              onClick={() => setHighContrast((previous) => !previous)}
              type="button"
              aria-label="Toggle high contrast mode"
            >
              <Contrast className="w-4 h-4" /> Contrast {highContrast ? "ON" : "OFF"}
            </button>
            <button
              className="btn-muted"
              onClick={() => setReduceMotionOverride((previous) => nextReducedMotionOverride(previous, prefersReducedMotion))}
              type="button"
              aria-label="Toggle reduced motion mode"
            >
              <Activity className="w-4 h-4" /> Reduce Motion {effectiveReducedMotion ? "ON" : "OFF"}
            </button>
            <button
              className="btn-muted"
              type="button"
              aria-label="Open keyboard shortcuts"
              aria-haspopup="dialog"
              aria-expanded={shortcutsOpen}
              onClick={openKeyboardShortcuts}
            >
              <Keyboard className="w-4 h-4" /> Shortcuts
            </button>
            {isBusy && (
              <span ref={runStatusRef} tabIndex={-1} className="run-state-chip" aria-live="polite">
                <Loader2 className="w-4 h-4 animate-spin" />
                {cancelRequested ? "Cancel requested..." : `Running ${activeCommandLabel} (${formatDuration(activeElapsedMs)})`}
              </span>
            )}
          </div>

          <p className="meta-muted">{friendlyMessage}</p>
        </header>

        <nav className="glass-card left-nav" aria-label="Navigation">
          <button
            type="button"
            className={`nav-item ${activeView === "dashboard" ? "nav-item-active" : ""}`}
            onClick={() => setActiveView("dashboard")}
            aria-label="Open dashboard view"
          >
            <Activity className="w-4 h-4" /> Dashboard
          </button>
          <button
            type="button"
            className={`nav-item ${activeView === "tasks" ? "nav-item-active" : ""}`}
            onClick={() => setActiveView("tasks")}
            aria-label="Open tasks view"
          >
            <ListChecks className="w-4 h-4" /> Tasks
          </button>
          <button
            type="button"
            className={`nav-item ${activeView === "output" ? "nav-item-active" : ""}`}
            onClick={() => setActiveView("output")}
            aria-label="Open output view"
          >
            <TerminalSquare className="w-4 h-4" /> Output
          </button>
        </nav>

        <main id="main" className="main-content" aria-label="Main content">
          <AnimatePresence mode="wait">
            {activeView === "dashboard" && (
              <motion.div
                key="dashboard"
                className="glass-card content-card"
                initial={motionInitial}
                animate={{ opacity: 1, y: 0 }}
                exit={motionExit}
                transition={motionTransition}
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
                initial={motionInitial}
                animate={{ opacity: 1, y: 0 }}
                exit={motionExit}
                transition={motionTransition}
              >
                <h2 className="section-title">Task Dry-Run</h2>
                <p className="meta-muted">Task names are sourced from `nlx list-tasks` and validated server-side.</p>

                <div className="task-controls">
                  <button
                    className="btn-muted"
                    onClick={() => void loadTasks()}
                    disabled={isBusy}
                    aria-label="Refresh task list"
                  >
                    Refresh Task List
                  </button>
                  <button
                    className="btn-theme"
                    onClick={() => void runDryRunSelected()}
                    disabled={isBusy || selectedTasks.length === 0}
                    aria-label="Run selected tasks in dry-run mode"
                  >
                    Run Selected Tasks
                  </button>
                  <label className="search-control" aria-label="Search tasks">
                    <Search className="w-4 h-4" />
                    <input
                      ref={tasksSearchInputRef}
                      type="search"
                      placeholder="Search tasks"
                      value={taskSearchQuery}
                      onChange={(event) => setTaskSearchQuery(event.target.value)}
                      aria-label="Search tasks"
                    />
                  </label>
                </div>

                <p className="meta-muted" aria-live="polite">
                  Showing {visibleTaskRows.length} of {filteredTaskRows.length} task(s).
                </p>
                <p className="meta-muted">Latest task result rows: {taskResults.length}</p>

                {filteredTaskRows.length === 0 ? (
                  <p className="meta-muted">No tasks match the current search query.</p>
                ) : (
                  <div
                    className="task-list"
                    role="listbox"
                    aria-label="Task list"
                    aria-activedescendant={selectedTaskRow ? taskRowId(selectedTaskRow.taskName) : undefined}
                  >
                    {visibleTaskRows.map((task) => {
                      const isRowSelected = selectedTaskRow?.taskName === task.taskName;
                      const selectedForRun = selectedTasks.includes(task.taskName);
                      return (
                        <div
                          key={task.taskName}
                          className={`task-row-shell ${isRowSelected ? "task-row-shell-active" : ""}`}
                        >
                          <button
                            id={taskRowId(task.taskName)}
                            type="button"
                            role="option"
                            aria-selected={isRowSelected}
                            className="task-row-button"
                            onClick={() => setSelectedTaskName(task.taskName)}
                          >
                            <div className="task-row-header">
                              <strong>{task.taskName}</strong>
                              <span className={`status-pill ${statusClass(task.status)}`}>{task.status}</span>
                            </div>
                            <p className="task-row-reason">{task.reason}</p>
                            <div className="task-row-meta">
                              <span>Last run: {task.lastRunAt ? formatTimestamp(task.lastRunAt) : "n/a"}</span>
                              <ChevronRight className="w-4 h-4" aria-hidden="true" />
                            </div>
                          </button>
                          <label className="task-row-select">
                            <input
                              type="checkbox"
                              checked={selectedForRun}
                              onChange={(event) => handleTaskSelectionToggle(task.taskName, event.target.checked)}
                              aria-label={`Include ${task.taskName} in dry-run selection`}
                            />
                            <span>Run</span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}

                {visibleTaskRows.length < filteredTaskRows.length && (
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() =>
                      setTaskVisibleLimit((previous) =>
                        nextVisibleTaskLimit(previous, filteredTaskRows.length, TASK_VISIBLE_STEP),
                      )
                    }
                    aria-label="Show more tasks"
                  >
                    Show more
                  </button>
                )}
              </motion.div>
            )}

            {activeView === "output" && (
              <motion.div
                key="output"
                className="glass-card content-card"
                initial={motionInitial}
                animate={{ opacity: 1, y: 0 }}
                exit={motionExit}
                transition={motionTransition}
              >
                <h2 className="section-title">Live Output Viewer</h2>
                <p className="meta-muted">Filter timeline entries and inspect redacted stdout/stderr per command.</p>

                <section className="sessions-panel" aria-label="Run sessions">
                  <div className="sessions-header">
                    <h3>Run Sessions</h3>
                    <div className="sessions-header-actions">
                      <button
                        className="btn-muted"
                        type="button"
                        onClick={() => setSessionsPanelOpen((previous) => !previous)}
                        aria-label={sessionsPanelOpen ? "Collapse sessions panel" : "Expand sessions panel"}
                      >
                        {sessionsPanelOpen ? "Collapse" : "Expand"}
                      </button>
                      <button
                        className="btn-muted"
                        type="button"
                        onClick={clearSessionHistoryWithConfirm}
                        disabled={runSessions.length === 0}
                        aria-label="Clear run session history"
                      >
                        <Trash2 className="w-4 h-4" /> Clear History
                      </button>
                    </div>
                  </div>

                  {sessionsPanelOpen && (
                    <>
                      <div className="sessions-filters">
                        <label className="select-control" aria-label="Filter sessions by command">
                          <span>Command</span>
                          <select
                            value={sessionCommandFilter}
                            onChange={(event) => setSessionCommandFilter(event.target.value as "ALL" | CommandId)}
                          >
                            <option value="ALL">All</option>
                            {sessionCommandOptions.map((commandId) => (
                              <option key={commandId} value={commandId}>
                                {commandId}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="select-control" aria-label="Filter sessions by badge">
                          <span>Badge</span>
                          <select
                            value={sessionBadgeFilter}
                            onChange={(event) => setSessionBadgeFilter(event.target.value as "ALL" | HealthBadge)}
                          >
                            <option value="ALL">All</option>
                            <option value="OK">OK</option>
                            <option value="DEGRADED">DEGRADED</option>
                            <option value="BROKEN">BROKEN</option>
                          </select>
                        </label>
                        <label className="select-control" aria-label="Filter sessions by time range">
                          <span>Range</span>
                          <select
                            value={sessionTimeRange}
                            onChange={(event) => setSessionTimeRange(event.target.value as RunSessionTimeRange)}
                          >
                            <option value="today">Today</option>
                            <option value="7d">7d</option>
                            <option value="all">All</option>
                          </select>
                        </label>
                        <label className="session-toggle">
                          <input
                            type="checkbox"
                            checked={sessionDegradedOnly}
                            onChange={(event) => setSessionDegradedOnly(event.target.checked)}
                          />
                          <span>Degraded only</span>
                        </label>
                      </div>

                      <div className="sessions-export-center">
                        <button
                          className="btn-muted"
                          type="button"
                          onClick={exportSelectedSessionJson}
                          disabled={!selectedSession}
                          aria-label="Export selected session JSON"
                        >
                          <FileJson2 className="w-4 h-4" /> Session JSON
                        </button>
                        <button
                          className="btn-muted"
                          type="button"
                          onClick={exportSelectedSessionReport}
                          disabled={!selectedSession}
                          aria-label="Export selected operator report"
                        >
                          <Download className="w-4 h-4" /> Session Report
                        </button>
                        <button
                          className="btn-muted"
                          type="button"
                          onClick={exportSessionBundle}
                          disabled={runSessions.length === 0}
                          aria-label="Export filtered session bundle"
                        >
                          <Download className="w-4 h-4" /> Bundle JSON
                        </button>
                      </div>

                      {filteredSessions.length === 0 ? (
                        <p className="meta-muted">No run sessions match the current filters.</p>
                      ) : (
                        <div
                          ref={sessionsListRef}
                          className="sessions-list"
                          role="listbox"
                          tabIndex={-1}
                          aria-label="Run session list"
                          aria-activedescendant={selectedSession ? `session-${selectedSession.id}` : undefined}
                        >
                          {filteredSessions.map((session) => {
                            const isSelected = selectedSession?.id === session.id;
                            return (
                              <div
                                key={session.id}
                                className={`session-row ${isSelected ? "session-row-active" : ""}`}
                              >
                                <button
                                  id={`session-${session.id}`}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  className="session-row-button"
                                  onClick={() => openSession(session.id)}
                                >
                                  <div className="session-row-heading">
                                    <span className={`status-pill ${session.statusClass}`}>{session.badge}</span>
                                    <strong>{session.label}</strong>
                                  </div>
                                  <div className="session-row-meta">
                                    <span>{formatTimestamp(session.startedAt)}</span>
                                    <span>{session.durationLabel}</span>
                                    <span>{session.reasonCode}</span>
                                  </div>
                                </button>
                                <button
                                  className="btn-muted session-pin-btn"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleSessionPinned(session.id);
                                  }}
                                  aria-label={session.pinned ? "Unpin session" : "Pin session"}
                                >
                                  {session.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </section>

                <div className="output-controls">
                  <label className="search-control" aria-label="Search redacted output">
                    <Search className="w-4 h-4" />
                    <input
                      ref={outputSearchInputRef}
                      type="search"
                      placeholder="Search output"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      aria-label="Search output text"
                    />
                  </label>
                  <label className="select-control" aria-label="Filter by severity">
                    <span>Severity</span>
                    <select
                      value={severityFilter}
                      onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                      aria-label="Severity filter"
                    >
                      <option value="ALL">All</option>
                      <option value="PASS">PASS</option>
                      <option value="WARN">WARN</option>
                      <option value="FAIL">FAIL</option>
                      <option value="RUNNING">RUNNING</option>
                    </select>
                  </label>
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() => void copyCurrentDeepLink()}
                    aria-label="Copy deep link for current output view"
                  >
                    <Link2 className="w-4 h-4" /> Copy Link
                  </button>
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() => downloadRedactedLog(filteredHistory)}
                    disabled={filteredHistory.length === 0}
                    aria-label="Download redacted log"
                  >
                    <Download className="w-4 h-4" /> Download Redacted Log
                  </button>
                </div>

                <section ref={outputHeaderRef} tabIndex={-1} className="sticky-run-header" aria-live="polite">
                  {selectedSession ? (
                    <>
                      <div className="sticky-run-meta">
                        <span className={`status-pill ${selectedSession.statusClass}`}>{selectedSession.badge}</span>
                        <strong>{selectedSession.label}</strong>
                        <span>{formatTimestamp(selectedSession.startedAt)}</span>
                        <span>Duration {selectedSession.durationLabel}</span>
                        <span>Reason {selectedSession.reasonCode}</span>
                      </div>
                      <div className="sticky-run-actions">
                        <button
                          className="copy-btn"
                          type="button"
                          onClick={() => selectedEvent && void copyEventOutput(selectedEvent)}
                          disabled={!selectedEvent}
                          aria-label="Copy selected event redacted output"
                        >
                          <Copy className="w-4 h-4" /> Copy Redacted
                        </button>
                        <button
                          className="btn-muted"
                          type="button"
                          onClick={() => selectedEvent && downloadRedactedLog([selectedEvent])}
                          disabled={!selectedEvent}
                          aria-label="Download selected event redacted output"
                        >
                          <Download className="w-4 h-4" /> Download Event
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="meta-muted">Select an event to inspect run details.</p>
                  )}
                </section>

                {filteredHistory.length === 0 ? (
                  <p className="meta-muted">No output entries for the selected filter.</p>
                ) : (
                  <div className="timeline-list" role="list" aria-label="Command timeline">
                    {filteredHistory.map((event) => {
                      const groupedEvent = groupTaskResults(event.taskResults);

                      return (
                        <article
                          key={event.id}
                          className={`timeline-item ${selectedEvent?.id === event.id ? "timeline-item-active" : ""}`}
                          role="listitem"
                          tabIndex={0}
                          aria-current={selectedEvent?.id === event.id ? "true" : undefined}
                          aria-label={`${event.label} ${event.outcome}. Press Enter to select.`}
                          onClick={() => setSelectedEventId(event.id)}
                          onKeyDown={(keyboardEvent) => {
                            if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                              keyboardEvent.preventDefault();
                              setSelectedEventId(event.id);
                            }
                          }}
                        >
                          <header className="timeline-header">
                            <div className="timeline-heading">
                              <span className={`status-pill ${statusClass(event.outcome)}`}>{event.outcome}</span>
                              <strong>{event.label}</strong>
                            </div>
                            <button
                              className="copy-btn"
                              type="button"
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation();
                                void copyEventOutput(event);
                              }}
                              aria-label={`Copy redacted output for ${event.label}`}
                            >
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
                            <div className="grouped-output">
                              <details className="group-details" open>
                                <summary>Grouped by Severity</summary>
                                {groupedEvent.bySeverity.map((group) => (
                                  <section key={`${event.id}-severity-${group.severity}`} className="group-block">
                                    <h4>
                                      <span className={`status-pill ${statusClass(group.severity)}`}>{group.severity}</span>
                                      <span>{group.items.length} item(s)</span>
                                    </h4>
                                    <ul>
                                      {group.items.map((item, index) => (
                                        <li key={`${event.id}-${group.severity}-${item.taskName}-${index}`}>
                                          <strong>{item.taskName}</strong>
                                          <p>{item.reason}</p>
                                        </li>
                                      ))}
                                    </ul>
                                  </section>
                                ))}
                              </details>

                              <details className="group-details">
                                <summary>Grouped by Task</summary>
                                {groupedEvent.byTask.map((group) => (
                                  <section key={`${event.id}-task-${group.taskName}`} className="group-block">
                                    <h4>{group.taskName}</h4>
                                    <ul>
                                      {group.items.map((item, index) => (
                                        <li key={`${event.id}-${group.taskName}-${item.status}-${index}`}>
                                          <span className={`status-pill ${statusClass(item.status)}`}>{item.status}</span>
                                          <p>{item.reason}</p>
                                        </li>
                                      ))}
                                    </ul>
                                  </section>
                                ))}
                              </details>
                            </div>
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
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <aside className="glass-card inspector-panel" aria-label="Inspector">
          <h2 className="section-title">Inspector</h2>
          {isBusy ? (
            <div className="inspector-live">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {cancelRequested
                  ? "Cancel requested..."
                  : `Running: ${activeCommandLabel || "Command"} (${formatDuration(activeElapsedMs)})`}
              </span>
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

          {activeView === "tasks" ? (
            selectedTaskRow ? (
              <div className="inspector-event">
                <h3>{selectedTaskRow.taskName}</h3>
                <p className="meta-muted">
                  <span className={`status-pill ${statusClass(selectedTaskRow.status)}`}>{selectedTaskRow.status}</span>
                </p>
                <p className="meta-muted">Reason: {selectedTaskRow.reason}</p>
                <p className="meta-muted">
                  Last run: {selectedTaskRow.lastRunAt ? formatTimestamp(selectedTaskRow.lastRunAt) : "n/a"}
                </p>
                <button
                  className="btn-muted"
                  type="button"
                  onClick={() => void copySelectedTaskDetails(selectedTaskRow)}
                  aria-label={`Copy redacted details for ${selectedTaskRow.taskName}`}
                >
                  <Copy className="w-4 h-4" /> Copy Details
                </button>
                <details open>
                  <summary>Redacted output snippet</summary>
                  <pre className="terminal-window">
                    {selectedTaskRow.outputSnippet || "(no output snippet available for this task yet)"}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="meta-muted">Select a task to inspect status and details.</p>
            )
          ) : activeView === "output" ? (
            selectedSession ? (
              <div className="inspector-event">
                <h3>{selectedSession.label}</h3>
                <p className="meta-muted">Command: {selectedSession.commandId}</p>
                <p className="meta-muted">Status: {selectedSession.badge}</p>
                <p className="meta-muted">Reason: {selectedSession.reasonCode}</p>
                <p className="meta-muted">Started: {formatTimestamp(selectedSession.startedAt)}</p>
                <p className="meta-muted">Duration: {selectedSession.durationLabel}</p>

                <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
                  <button
                    type="button"
                    role="tab"
                    className={`btn-muted ${inspectorSection === "summary" ? "inspector-tab-active" : ""}`}
                    aria-selected={inspectorSection === "summary"}
                    onClick={() => setInspectorSection("summary")}
                  >
                    Summary
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`btn-muted ${inspectorSection === "events" ? "inspector-tab-active" : ""}`}
                    aria-selected={inspectorSection === "events"}
                    onClick={() => setInspectorSection("events")}
                  >
                    Events
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`btn-muted ${inspectorSection === "tasks" ? "inspector-tab-active" : ""}`}
                    aria-selected={inspectorSection === "tasks"}
                    onClick={() => setInspectorSection("tasks")}
                  >
                    Tasks
                  </button>
                </div>

                {inspectorSection === "summary" && (
                  <div className="inspector-section-block">
                    <p className="meta-muted">{selectedSession.note}</p>
                    <p className="meta-muted">Session ID: {selectedSession.id}</p>
                    <p className="meta-muted">Event ID: {selectedSession.eventId}</p>
                    <p className="meta-muted">Redacted: {selectedSession.redacted ? "yes" : "no"}</p>
                  </div>
                )}

                {inspectorSection === "events" && (
                  <div className="inspector-section-block">
                    {selectedSession.events.length === 0 ? (
                      <p className="meta-muted">No session events available.</p>
                    ) : (
                      <ul className="session-event-list">
                        {selectedSession.events.map((event) => (
                          <li key={event.id}>
                            <span>+{event.offsetMs}ms</span>
                            <span>[{event.level}]</span>
                            <p>{event.msg}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {inspectorSection === "tasks" && (
                  <div className="inspector-section-block">
                    {selectedSession.taskResults.length === 0 ? (
                      <p className="meta-muted">No task results in this session.</p>
                    ) : (
                      <div className="inspector-groups">
                        <details open>
                          <summary>Severity groups</summary>
                          <ul>
                            {selectedSessionTaskGroups.bySeverity.map((group) => (
                              <li key={`session-inspector-severity-${group.severity}`}>
                                <span className={`status-pill ${statusClass(group.severity)}`}>{group.severity}</span>
                                <span>{group.items.length}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                        <details>
                          <summary>Task groups</summary>
                          <ul>
                            {selectedSessionTaskGroups.byTask.map((group) => (
                              <li key={`session-inspector-task-${group.taskName}`}>
                                <strong>{group.taskName}</strong>
                                <span>{group.items.length}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="meta-muted">Select a run session to inspect details.</p>
            )
          ) : selectedEvent ? (
            <div className="inspector-event">
              <h3>{selectedEvent.label}</h3>
              <p className="meta-muted">{selectedEvent.note}</p>
              <p className="meta-muted">Status: {selectedEvent.outcome}</p>
              <p className="meta-muted">Started: {formatTimestamp(selectedEvent.startedAt)}</p>
              <p className="meta-muted">Duration: {formatDuration(selectedEvent.durationMs)}</p>
              {selectedEvent.taskResults.length > 0 && (
                <div className="inspector-groups">
                  <details open>
                    <summary>Severity groups</summary>
                    <ul>
                      {selectedEventGroups.bySeverity.map((group) => (
                        <li key={`inspector-severity-${group.severity}`}>
                          <span className={`status-pill ${statusClass(group.severity)}`}>{group.severity}</span>
                          <span>{group.items.length}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <details>
                    <summary>Task groups</summary>
                    <ul>
                      {selectedEventGroups.byTask.map((group) => (
                        <li key={`inspector-task-${group.taskName}`}>
                          <strong>{group.taskName}</strong>
                          <span>{group.items.length}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </div>
          ) : (
            <p className="meta-muted">Select a timeline event to inspect details.</p>
          )}
        </aside>
      </div>

      {shortcutsOpen && (
        <div className="shortcut-overlay" role="presentation">
          <div
            ref={shortcutDialogRef}
            className="shortcut-dialog glass-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcut-dialog-title"
            onKeyDown={handleShortcutDialogKeyDown}
          >
            <header className="shortcut-header">
              <h2 id="shortcut-dialog-title" className="section-title">
                Keyboard Shortcuts
              </h2>
              <button ref={shortcutCloseRef} className="btn-muted" type="button" onClick={closeKeyboardShortcuts}>
                <X className="w-4 h-4" /> Close
              </button>
            </header>
            <ul className="shortcut-list">
              <li>
                <kbd>?</kbd>
                <span>Open shortcuts help</span>
              </li>
              <li>
                <kbd>Esc</kbd>
                <span>Close shortcuts help</span>
              </li>
              <li>
                <kbd>/</kbd>
                <span>Focus search (Output or Tasks view)</span>
              </li>
              <li>
                <kbd>g d</kbd>
                <span>Go to Dashboard</span>
              </li>
              <li>
                <kbd>g t</kbd>
                <span>Go to Tasks</span>
              </li>
              <li>
                <kbd>g o</kbd>
                <span>Go to Output</span>
              </li>
              <li>
                <kbd>↑ / ↓</kbd>
                <span>Navigate sessions (Output view)</span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
