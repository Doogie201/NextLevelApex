"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type { CommandId } from "@/engine/commandContract";
import { isRunEnvelope } from "@/engine/apiContract";
import { buildDiagnosticsText } from "@/engine/diagnosticsPayload";
import { compareRunSessions } from "@/engine/sessionCompare";
import { buildGuiSettingsExportJson, clearGuiSettings } from "@/engine/guiSettings";
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
  type UrlWorkspaceMode,
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
  addOrUpdatePreset,
  buildRunPreset,
  createPresetId,
  duplicatePreset,
  loadRunPresets,
  markPresetUsed,
  parsePresetTaskInput,
  PRESETS_SCHEMA_VERSION,
  storeRunPresets,
  type RunPreset,
  type RunPresetConfig,
} from "@/engine/presetsStore";
import {
  buildPresetsExportJson,
  mergeImportedPresets,
  parsePresetsImportJson,
} from "@/engine/presetsExport";
import {
  addSavedView,
  deleteSavedView,
  loadSavedViews,
  storeSavedViews,
  type SavedViewEntry,
} from "@/engine/savedViewsStore";
import {
  buildRunCenterModel,
  validatePresetName,
  type RunCenterCommandId,
} from "@/engine/runCenterModel";
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
  buildSessionCompareReportBundle,
  buildSessionReportBundle,
} from "@/engine/sessionReport";
import {
  buildTimelineSummary,
  groupTimelineEvents,
  type TimelineGroupMode,
} from "@/engine/timelineInsights";
import {
  buildSessionBundleExportJson,
  buildSessionExportJson,
  buildSessionOperatorReport,
} from "@/engine/sessionExport";
import {
  buildInvestigationBundleJson,
  type BundlePresetSelection,
  type InvestigationBundle,
} from "@/engine/bundleExport";
import {
  applyInvestigationBundleImport,
  previewInvestigationBundleImport,
  validateInvestigationBundleInput,
  type BundleImportPreview,
  type BundleImportValidationError,
} from "@/engine/bundleImport";

type ViewId = UrlViewId;
type SeverityFilter = UrlSeverityFilter;
type InspectorSection = UrlInspectorSection;
type WorkspaceMode = UrlWorkspaceMode;
interface TaskRowSummary {
  taskName: string;
  status: TaskResult["status"];
  reason: string;
  lastRunAt: string | null;
  outputSnippet: string;
}

const TASK_VISIBLE_STEP = 200;
const GUI_BUILD_ID = "phase11";
const MAX_PRESET_NAME_LENGTH = 64;

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
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null);
  const [taskResults, setTaskResults] = useState<TaskResult[]>([]);
  const [commandHistory, setCommandHistory] = useState<CommandEvent[]>([]);
  const [runSessions, setRunSessions] = useState<RunSession[]>([]);
  const [presets, setPresets] = useState<RunPreset[]>([]);
  const [savedViews, setSavedViews] = useState<SavedViewEntry[]>([]);
  const [savedViewName, setSavedViewName] = useState("Workspace");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("Diagnose baseline");
  const [presetCommandId, setPresetCommandId] = useState<RunCenterCommandId>("diagnose");
  const [presetTaskInput, setPresetTaskInput] = useState("");
  const [showRunCenterDisabledReason, setShowRunCenterDisabledReason] = useState(false);
  const [lastRunConfig, setLastRunConfig] = useState<RunPresetConfig | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [compareSessionId, setCompareSessionId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [inspectorSection, setInspectorSection] = useState<InspectorSection>("summary");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [timelineGroupMode, setTimelineGroupMode] = useState<TimelineGroupMode>("chronological");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("balanced");
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
  const [consoleHelpOpen, setConsoleHelpOpen] = useState(false);
  const [bundleExportOpen, setBundleExportOpen] = useState(false);
  const [bundlePresetSelection, setBundlePresetSelection] = useState<BundlePresetSelection>("current");
  const [bundleSessionIds, setBundleSessionIds] = useState<string[]>([]);
  const [bundleViewNames, setBundleViewNames] = useState<string[]>([]);
  const [bundleImportRaw, setBundleImportRaw] = useState("");
  const [bundleImportErrors, setBundleImportErrors] = useState<BundleImportValidationError[]>([]);
  const [bundleImportPreview, setBundleImportPreview] = useState<BundleImportPreview | null>(null);
  const [validatedBundle, setValidatedBundle] = useState<InvestigationBundle | null>(null);
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
  const presetsImportInputRef = useRef<HTMLInputElement | null>(null);
  const sessionsListRef = useRef<HTMLDivElement | null>(null);
  const tasksSearchInputRef = useRef<HTMLInputElement | null>(null);
  const shortcutCloseRef = useRef<HTMLButtonElement | null>(null);
  const shortcutDialogRef = useRef<HTMLDivElement | null>(null);
  const shortcutOpenerRef = useRef<HTMLElement | null>(null);
  const consoleHelpCloseRef = useRef<HTMLButtonElement | null>(null);
  const consoleHelpDialogRef = useRef<HTMLDivElement | null>(null);
  const consoleHelpOpenerRef = useRef<HTMLElement | null>(null);
  const bundleExportCloseRef = useRef<HTMLButtonElement | null>(null);
  const bundleExportDialogRef = useRef<HTMLDivElement | null>(null);
  const bundleExportOpenerRef = useRef<HTMLElement | null>(null);

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

  const selectedPreset = useMemo(
    () => (selectedPresetId ? presets.find((preset) => preset.id === selectedPresetId) ?? null : presets[0] ?? null),
    [presets, selectedPresetId],
  );

  const applyParsedUrlState = useCallback(
    (parsed: ReturnType<typeof parseUrlState>): void => {
      setActiveView(parsed.view);
      setSelectedEventId(parsed.eventId);
      setSelectedSessionId(parsed.sessionId);
      setCompareSessionId(parsed.compareSessionId);
      setSeverityFilter(parsed.severity);
      setInspectorSection(parsed.inspectorSection);
      setTimelineGroupMode(parsed.timelineGroup);
      setWorkspaceMode(parsed.workspace);
      setSearchQuery(parsed.q);
    },
    [],
  );

  const runCenterTaskNames = useMemo(() => parsePresetTaskInput(presetTaskInput), [presetTaskInput]);

  const runCenterModel = useMemo(
    () =>
      buildRunCenterModel({
        commandId: presetCommandId,
        taskNames: runCenterTaskNames,
        isBusy,
        toggles: {
          readOnly,
          highContrast,
          reducedMotion: effectiveReducedMotion,
        },
      }),
    [effectiveReducedMotion, highContrast, isBusy, presetCommandId, readOnly, runCenterTaskNames],
  );

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
    applyParsedUrlState(parsed);
    setIsUrlStateReady(true);
  }, [applyParsedUrlState]);

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

    const loadedPresets = loadRunPresets(window.localStorage);
    setPresets(loadedPresets);
    if (loadedPresets.length > 0) {
      setSelectedPresetId(loadedPresets[0].id);
    }

    const loadedSavedViews = loadSavedViews(window.localStorage);
    setSavedViews(loadedSavedViews);
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
    if (typeof window === "undefined") {
      return;
    }
    storeRunPresets(window.localStorage, presets);
  }, [presets]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    storeSavedViews(window.localStorage, savedViews);
  }, [savedViews]);

  useEffect(() => {
    if (presets.length === 0) {
      setSelectedPresetId(null);
      return;
    }
    if (!selectedPresetId || !presets.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId(presets[0].id);
    }
  }, [presets, selectedPresetId]);

  useEffect(() => {
    if (runCenterModel.canRun && showRunCenterDisabledReason) {
      setShowRunCenterDisabledReason(false);
    }
  }, [runCenterModel.canRun, showRunCenterDisabledReason]);

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
      compareSessionId,
      severity: severityFilter,
      inspectorSection,
      timelineGroup: timelineGroupMode,
      workspace: workspaceMode,
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
    timelineGroupMode,
    searchQuery,
    compareSessionId,
    selectedEventId,
    selectedSessionId,
    severityFilter,
    workspaceMode,
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
    setConsoleHelpOpen(false);
    setShortcutsOpen(true);
    setLiveMessage("Keyboard shortcuts opened.");
  }, []);

  const closeKeyboardShortcuts = useCallback((): void => {
    setShortcutsOpen(false);
    setLiveMessage("Keyboard shortcuts closed.");
    shortcutOpenerRef.current?.focus();
  }, []);

  const openConsoleHelp = useCallback((): void => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      consoleHelpOpenerRef.current = document.activeElement;
    }
    setShortcutsOpen(false);
    setConsoleHelpOpen(true);
    setLiveMessage("Console help opened.");
  }, []);

  const closeConsoleHelp = useCallback((): void => {
    setConsoleHelpOpen(false);
    setLiveMessage("Console help closed.");
    consoleHelpOpenerRef.current?.focus();
  }, []);

  const openBundleExport = useCallback((): void => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      bundleExportOpenerRef.current = document.activeElement;
    }
    const defaultSessionId =
      selectedSessionId && runSessions.some((session) => session.id === selectedSessionId)
        ? selectedSessionId
        : runSessions[0]?.id ?? null;
    setBundleSessionIds(defaultSessionId ? [defaultSessionId] : []);
    setBundleViewNames(savedViews.map((view) => view.name));
    setBundlePresetSelection(selectedPreset ? "preset" : runCenterModel.config ? "current" : "none");
    setBundleImportRaw("");
    setBundleImportErrors([]);
    setBundleImportPreview(null);
    setValidatedBundle(null);
    setBundleExportOpen(true);
    setLiveMessage("Bundle export opened.");
  }, [runCenterModel.config, runSessions, savedViews, selectedPreset, selectedSessionId]);

  const closeBundleExport = useCallback((): void => {
    setBundleExportOpen(false);
    setBundleImportErrors([]);
    setBundleImportPreview(null);
    setValidatedBundle(null);
    setLiveMessage("Bundle export closed.");
    bundleExportOpenerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!shortcutsOpen) {
      return;
    }
    shortcutCloseRef.current?.focus();
  }, [shortcutsOpen]);

  useEffect(() => {
    if (!consoleHelpOpen) {
      return;
    }
    consoleHelpCloseRef.current?.focus();
  }, [consoleHelpOpen]);

  useEffect(() => {
    if (!bundleExportOpen) {
      return;
    }
    bundleExportCloseRef.current?.focus();
  }, [bundleExportOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (bundleExportOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeBundleExport();
        }
        return;
      }

      if (consoleHelpOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeConsoleHelp();
        }
        return;
      }

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
  }, [
    activeView,
    bundleExportOpen,
    closeBundleExport,
    closeConsoleHelp,
    closeKeyboardShortcuts,
    consoleHelpOpen,
    openKeyboardShortcuts,
    setViewByShortcut,
    shortcutState,
    shortcutsOpen,
  ]);

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
      const message = summarizeCommandResult(result);
      setTaskLoadError(message);
      setFriendlyMessage(message);
      return;
    }

    const taskNames = result.taskNames ?? [];
    setKnownTasks(taskNames);
    setSelectedTasks((previous) => previous.filter((task) => taskNames.includes(task)));
    setTaskLoadError(null);
  }, [executeCommand]);

  const runDiagnose = useCallback(async (): Promise<void> => {
    setActiveView("dashboard");
    setIsBusy(true);
    setFriendlyMessage("Running diagnose command...");
    setLastRunConfig({
      commandId: "diagnose",
      taskNames: [],
      dryRun: true,
      toggles: { readOnly },
    });

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
  }, [executeCommand, readOnly]);

  const runDryRunSweep = useCallback(async (): Promise<void> => {
    setActiveView("output");
    setIsBusy(true);
    setFriendlyMessage("Running full dry-run sweep...");
    setLastRunConfig({
      commandId: "dryRunAll",
      taskNames: [],
      dryRun: true,
      toggles: { readOnly },
    });

    try {
      const result = await executeCommand("dryRunAll");
      setTaskResults(result.taskResults ?? []);
      setFriendlyMessage(result.ok ? "Dry-run sweep complete." : summarizeCommandResult(result));
    } finally {
      setIsBusy(false);
    }
  }, [executeCommand, readOnly]);

  const runDryRunSelected = useCallback(async (tasksOverride?: string[]): Promise<void> => {
    const tasksToRun = tasksOverride ?? selectedTasks;
    if (tasksToRun.length === 0) {
      setFriendlyMessage("Select at least one task first.");
      return;
    }

    setActiveView("output");
    setIsBusy(true);
    setFriendlyMessage(`Running dry-run for ${tasksToRun.length} task(s)...`);
    setLastRunConfig({
      commandId: "dryRunTask",
      taskNames: [...tasksToRun].sort((left, right) => left.localeCompare(right)),
      dryRun: true,
      toggles: { readOnly },
    });

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
  }, [executeCommand, knownTasks, readOnly, selectedTasks]);

  const runFromPresetConfig = useCallback(
    async (config: RunPresetConfig): Promise<void> => {
      if (isBusy) {
        setFriendlyMessage("A command is already running.");
        return;
      }
      if (config.commandId === "diagnose") {
        await runDiagnose();
        return;
      }
      if (config.commandId === "dryRunAll") {
        await runDryRunSweep();
        return;
      }
      await runDryRunSelected(config.taskNames);
    },
    [isBusy, runDiagnose, runDryRunSelected, runDryRunSweep],
  );

  const buildPresetConfigFromInputs = useCallback((): RunPresetConfig | null => {
    if (!runCenterModel.config) {
      setFriendlyMessage(runCenterModel.disabledReason || "Run configuration is incomplete.");
      setShowRunCenterDisabledReason(true);
      return null;
    }
    return runCenterModel.config;
  }, [runCenterModel]);

  const savePresetFromInputs = useCallback((): void => {
    const config = buildPresetConfigFromInputs();
    if (!config) {
      return;
    }
    const nameValidation = validatePresetName(
      presetName,
      presets.map((preset) => preset.name),
    );
    if (!nameValidation.valid) {
      setFriendlyMessage(nameValidation.reason);
      return;
    }
    if (nameValidation.duplicate && typeof window !== "undefined") {
      const shouldOverwriteName = window.confirm(
        `${nameValidation.reason} Continue and save another preset with this name?`,
      );
      if (!shouldOverwriteName) {
        return;
      }
    }
    const nowIso = new Date().toISOString();
    const normalizedName = nameValidation.normalized.slice(0, MAX_PRESET_NAME_LENGTH);
    const id = createPresetId(normalizedName, nowIso);
    const preset = buildRunPreset({
      id,
      name: normalizedName,
      timestampIso: nowIso,
      config,
    });
    setPresets((previous) => addOrUpdatePreset(previous, preset));
    setSelectedPresetId(preset.id);
    setFriendlyMessage(`Saved preset: ${preset.name}.`);
  }, [buildPresetConfigFromInputs, presetName, presets]);

  const applySelectedPresetToRunCenter = useCallback((): void => {
    if (!selectedPreset) {
      setFriendlyMessage("Select a preset first.");
      return;
    }
    setPresetCommandId(selectedPreset.config.commandId);
    setPresetTaskInput(selectedPreset.config.taskNames.join(", "));
    setShowRunCenterDisabledReason(false);
    setFriendlyMessage(`Applied preset: ${selectedPreset.name}.`);
  }, [selectedPreset]);

  const runSelectedPreset = useCallback(async (): Promise<void> => {
    if (!selectedPreset) {
      setFriendlyMessage("Select a preset first.");
      return;
    }
    await runFromPresetConfig(selectedPreset.config);
    const nowIso = new Date().toISOString();
    setPresets((previous) => markPresetUsed(previous, selectedPreset.id, nowIso));
  }, [runFromPresetConfig, selectedPreset]);

  const duplicateSelectedPreset = useCallback((): void => {
    if (!selectedPreset) {
      setFriendlyMessage("Select a preset to duplicate.");
      return;
    }
    if (typeof window !== "undefined") {
      const shouldDuplicate = window.confirm(`Duplicate preset '${selectedPreset.name}'?`);
      if (!shouldDuplicate) {
        return;
      }
    }
    const nowIso = new Date().toISOString();
    setPresets((previous) => duplicatePreset(previous, selectedPreset.id, nowIso));
    setFriendlyMessage(`Duplicated preset: ${selectedPreset.name}.`);
  }, [selectedPreset]);

  const repeatLastRun = useCallback(async (): Promise<void> => {
    if (!lastRunConfig) {
      setFriendlyMessage("No prior run configuration available.");
      return;
    }
    setLiveMessage("Replaying last run configuration...");
    await runFromPresetConfig(lastRunConfig);
  }, [lastRunConfig, runFromPresetConfig]);

  const runFromRunCenter = useCallback(async (): Promise<void> => {
    if (!runCenterModel.config) {
      setFriendlyMessage(runCenterModel.disabledReason || "Run configuration is incomplete.");
      setShowRunCenterDisabledReason(true);
      return;
    }
    await runFromPresetConfig(runCenterModel.config);
  }, [runCenterModel, runFromPresetConfig]);

  const exportPresets = useCallback((): void => {
    if (typeof window === "undefined") {
      return;
    }
    if (presets.length === 0) {
      setFriendlyMessage("No presets available to export.");
      return;
    }
    const payload = buildPresetsExportJson(PRESETS_SCHEMA_VERSION, presets);
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nlx-presets-${timestamp}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    setFriendlyMessage("Exported presets JSON.");
  }, [presets]);

  const triggerPresetImport = useCallback((): void => {
    presetsImportInputRef.current?.click();
  }, []);

  const onPresetImportSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      try {
        const raw = await file.text();
        const imported = parsePresetsImportJson(raw);
        let merge = mergeImportedPresets(presets, imported, false);
        if (merge.skipped > 0 && typeof window !== "undefined") {
          const overwrite = window.confirm(
            `${merge.skipped} preset(s) match existing IDs. Overwrite existing presets with imported versions?`,
          );
          if (overwrite) {
            merge = mergeImportedPresets(presets, imported, true);
          }
        }
        setPresets(merge.presets);
        setFriendlyMessage(`Imported presets: +${merge.added}, updated ${merge.updated}, skipped ${merge.skipped}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid presets import file.";
        setFriendlyMessage(message);
      }
    },
    [presets],
  );

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

  const buildCurrentViewUrl = useCallback((): string => {
    if (typeof window === "undefined") {
      return "";
    }
    const search = toUrlSearch({
      view: activeView,
      eventId: selectedEventId,
      sessionId: selectedSessionId,
      compareSessionId,
      severity: severityFilter,
      inspectorSection,
      timelineGroup: timelineGroupMode,
      workspace: workspaceMode,
      q: searchQuery,
    });
    return `${window.location.origin}${window.location.pathname}${search.length > 0 ? `?${search}` : ""}`;
  }, [
    activeView,
    compareSessionId,
    inspectorSection,
    searchQuery,
    selectedEventId,
    selectedSessionId,
    severityFilter,
    timelineGroupMode,
    workspaceMode,
  ]);

  const copyCurrentDeepLink = useCallback(async (): Promise<void> => {
    const deepLink = buildCurrentViewUrl();
    if (!deepLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(deepLink);
      setFriendlyMessage("Copied deep link to current view and filters.");
    } catch {
      setFriendlyMessage("Clipboard write failed in this browser context.");
    }
  }, [buildCurrentViewUrl]);

  const saveCurrentView = useCallback((): void => {
    const currentUrl = buildCurrentViewUrl();
    if (!currentUrl) {
      return;
    }
    setSavedViews((previous) => {
      const result = addSavedView(previous, savedViewName, currentUrl);
      setFriendlyMessage(`Saved view: ${result.savedName}.`);
      return result.views;
    });
  }, [buildCurrentViewUrl, savedViewName]);

  const copySavedViewLink = useCallback(async (savedView: SavedViewEntry): Promise<void> => {
    try {
      await navigator.clipboard.writeText(savedView.url);
      setFriendlyMessage(`Copied saved view link: ${savedView.name}.`);
    } catch {
      setFriendlyMessage("Clipboard write failed in this browser context.");
    }
  }, []);

  const openSavedView = useCallback(
    (savedView: SavedViewEntry): void => {
      if (typeof window === "undefined") {
        return;
      }
      try {
        const parsedUrl = new URL(savedView.url, window.location.origin);
        const parsedState = parseUrlState(parsedUrl.search);
        applyParsedUrlState(parsedState);
        const nextSearch = parsedUrl.search;
        window.history.replaceState(null, "", `${window.location.pathname}${nextSearch}`);
        setFriendlyMessage(`Opened saved view: ${savedView.name}.`);
      } catch {
        setFriendlyMessage(`Saved view is invalid: ${savedView.name}.`);
      }
    },
    [applyParsedUrlState],
  );

  const removeSavedView = useCallback((name: string): void => {
    setSavedViews((previous) => deleteSavedView(previous, name));
    setFriendlyMessage(`Removed saved view: ${name}.`);
  }, []);

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

  const handleConsoleHelpDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeConsoleHelp();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const container = consoleHelpDialogRef.current;
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
    [closeConsoleHelp],
  );

  const handleBundleExportDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBundleExport();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const container = bundleExportDialogRef.current;
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
    [closeBundleExport],
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

  const compareSessionOptions = useMemo(
    () => sortRunSessions(runSessions).filter((session) => session.id !== selectedSessionId),
    [runSessions, selectedSessionId],
  );

  const selectedCompareSession = useMemo(() => {
    if (!compareSessionId) {
      return null;
    }
    return runSessions.find((session) => session.id === compareSessionId) ?? null;
  }, [compareSessionId, runSessions]);

  const selectedBundleSessions = useMemo(
    () => runSessions.filter((session) => bundleSessionIds.includes(session.id)),
    [bundleSessionIds, runSessions],
  );

  const selectedBundleViews = useMemo(
    () => savedViews.filter((view) => bundleViewNames.includes(view.name)),
    [bundleViewNames, savedViews],
  );

  const sessionComparison = useMemo(() => {
    if (!selectedSession || !selectedCompareSession) {
      return null;
    }
    return compareRunSessions(selectedSession, selectedCompareSession);
  }, [selectedCompareSession, selectedSession]);

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

  useEffect(() => {
    if (!compareSessionId) {
      return;
    }
    const exists = runSessions.some((session) => session.id === compareSessionId);
    if (!exists || compareSessionId === selectedSessionId) {
      setCompareSessionId(null);
    }
  }, [compareSessionId, runSessions, selectedSessionId]);

  useEffect(() => {
    setBundleSessionIds((previous) => previous.filter((id) => runSessions.some((session) => session.id === id)));
  }, [runSessions]);

  useEffect(() => {
    setBundleViewNames((previous) => previous.filter((name) => savedViews.some((view) => view.name === name)));
  }, [savedViews]);

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

  const groupedTimeline = useMemo(
    () => groupTimelineEvents(filteredHistory, timelineGroupMode),
    [filteredHistory, timelineGroupMode],
  );

  const timelineSummary = useMemo(() => {
    const sessionSource = filteredSessions.length > 0 ? filteredSessions : runSessions;
    return buildTimelineSummary(filteredHistory, sessionSource);
  }, [filteredHistory, filteredSessions, runSessions]);

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

  const exportDeterministicReportBundle = useCallback((): void => {
    if (!selectedSession) {
      setFriendlyMessage("Select a session before generating a report.");
      return;
    }

    if (selectedCompareSession) {
      const bundle = buildSessionCompareReportBundle(selectedSession, selectedCompareSession, GUI_BUILD_ID);
      const baseName = `nlx-compare-report-${selectedSession.id}-vs-${selectedCompareSession.id}`;
      downloadTextPayload(`${baseName}.json`, bundle.json);
      downloadTextPayload(`${baseName}.md`, bundle.markdown);
      setFriendlyMessage("Generated deterministic compare report bundle (redacted).");
      return;
    }

    const bundle = buildSessionReportBundle(selectedSession, GUI_BUILD_ID);
    const baseName = `nlx-session-report-${selectedSession.id}`;
    downloadTextPayload(`${baseName}.json`, bundle.json);
    downloadTextPayload(`${baseName}.md`, bundle.markdown);
    setFriendlyMessage("Generated deterministic session report bundle (redacted).");
  }, [downloadTextPayload, selectedCompareSession, selectedSession]);

  const toggleBundleSessionSelection = useCallback((sessionId: string, selected: boolean): void => {
    setBundleSessionIds((previous) => {
      if (selected) {
        return [...new Set([...previous, sessionId])];
      }
      return previous.filter((entry) => entry !== sessionId);
    });
  }, []);

  const toggleBundleViewSelection = useCallback((viewName: string, selected: boolean): void => {
    setBundleViewNames((previous) => {
      if (selected) {
        return [...new Set([...previous, viewName])];
      }
      return previous.filter((entry) => entry !== viewName);
    });
  }, []);

  const exportInvestigationBundle = useCallback((): void => {
    if (selectedBundleSessions.length === 0 && selectedBundleViews.length === 0 && bundlePresetSelection === "none") {
      setFriendlyMessage("Select at least one session, saved view, or preset source before exporting.");
      return;
    }

    const json = buildInvestigationBundleJson({
      guiVersionTag: GUI_BUILD_ID,
      repo: "Doogie201/NextLevelApex",
      presetSelection: bundlePresetSelection,
      selectedPreset,
      currentConfig: runCenterModel.config,
      viewUrls: selectedBundleViews.map((view) => view.url),
      sessions: selectedBundleSessions,
    });

    const firstSession = selectedBundleSessions[0]?.id ?? "bundle";
    downloadTextPayload(`nlx-investigation-bundle-${firstSession}.json`, json);
    setFriendlyMessage(
      `Exported investigation bundle (sessions: ${selectedBundleSessions.length}, views: ${selectedBundleViews.length}).`,
    );
    closeBundleExport();
  }, [
    bundlePresetSelection,
    closeBundleExport,
    downloadTextPayload,
    runCenterModel.config,
    selectedBundleSessions,
    selectedBundleViews,
    selectedPreset,
  ]);

  const validateBundleImport = useCallback((): void => {
    const validation = validateInvestigationBundleInput(bundleImportRaw);
    if (!validation.ok) {
      setBundleImportErrors(validation.errors);
      setBundleImportPreview(null);
      setValidatedBundle(null);
      setFriendlyMessage(validation.errors[0]?.message ?? "Bundle validation failed.");
      return;
    }

    const preview = previewInvestigationBundleImport(validation.bundle, presets, runSessions);
    setBundleImportErrors([]);
    setBundleImportPreview(preview);
    setValidatedBundle(validation.bundle);
    setFriendlyMessage(
      `Bundle validated (${preview.bundleKind}): presets ${preview.presetCandidates}, sessions ${preview.sessionCandidates}, duplicates ${preview.duplicateSessions + preview.duplicatePresets}.`,
    );
  }, [bundleImportRaw, presets, runSessions]);

  const importValidatedBundle = useCallback((): void => {
    if (!validatedBundle) {
      setFriendlyMessage("Validate a bundle before importing.");
      return;
    }

    const applied = applyInvestigationBundleImport({
      bundle: validatedBundle,
      existingPresets: presets,
      existingSessions: runSessions,
    });

    setPresets(applied.presets);
    setRunSessions(applied.sessions);
    setBundleImportPreview(applied.preview);
    setBundleImportErrors([]);
    setLiveMessage("Bundle import complete.");
    setFriendlyMessage(
      `Imported bundle: presets +${applied.addedPresets} (skipped ${applied.skippedPresets}), sessions +${applied.addedSessions} (skipped ${applied.skippedSessions}).`,
    );
  }, [presets, runSessions, validatedBundle]);

  const copyConsoleDiagnostics = useCallback(async (): Promise<void> => {
    if (typeof navigator === "undefined") {
      return;
    }
    const pinnedCount = runSessions.filter((session) => session.pinned).length;
    const payload = buildDiagnosticsText({
      guiBuild: GUI_BUILD_ID,
      userAgent: navigator.userAgent,
      readOnly,
      highContrast,
      reducedMotion: effectiveReducedMotion,
      sessionCount: runSessions.length,
      pinnedCount,
      activeView,
      selectedSessionId,
    });
    try {
      await navigator.clipboard.writeText(payload);
      setFriendlyMessage("Copied diagnostics summary.");
    } catch {
      setFriendlyMessage("Clipboard write failed in this browser context.");
    }
  }, [activeView, effectiveReducedMotion, highContrast, readOnly, runSessions, selectedSessionId]);

  const clearGuiSettingsWithConfirm = useCallback((): void => {
    if (typeof window === "undefined") {
      return;
    }
    if (!window.confirm("Clear GUI settings (contrast, reduced motion, and session filters)?")) {
      return;
    }
    clearGuiSettings(window.localStorage);
    setHighContrast(false);
    setReduceMotionOverride(null);
    setSessionsPanelOpen(true);
    setSessionCommandFilter("ALL");
    setSessionBadgeFilter("ALL");
    setSessionTimeRange("all");
    setSessionDegradedOnly(false);
    setFriendlyMessage("Cleared GUI settings.");
  }, []);

  const exportGuiSettings = useCallback((): void => {
    const payload = buildGuiSettingsExportJson({
      highContrast,
      reduceMotionOverride,
      sessionsPanelOpen,
      sessionFilters: {
        commandId: sessionCommandFilter,
        badge: sessionBadgeFilter,
        degradedOnly: sessionDegradedOnly,
        timeRange: sessionTimeRange,
      },
    });
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    downloadTextPayload(`nlx-gui-settings-${timestamp}.json`, payload);
    setFriendlyMessage("Exported GUI settings JSON.");
  }, [
    downloadTextPayload,
    highContrast,
    reduceMotionOverride,
    sessionBadgeFilter,
    sessionCommandFilter,
    sessionDegradedOnly,
    sessionTimeRange,
    sessionsPanelOpen,
  ]);

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
      <div className={`meta-shell layout-${workspaceMode}`}>
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
            <button
              className="btn-muted"
              type="button"
              aria-label="Open console help"
              aria-haspopup="dialog"
              aria-expanded={consoleHelpOpen}
              onClick={openConsoleHelp}
            >
              <CircleHelp className="w-4 h-4" /> Console Help
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

                <section className="sessions-panel" aria-label="Guided run flow and presets">
                  <div className="sessions-header">
                    <h3>Run Center</h3>
                    <p className="meta-muted">
                      Choose a command, review a deterministic summary, then run safely in read-only mode.
                    </p>
                  </div>
                  <div className="sessions-filters">
                    <label className="select-control" aria-label="Run Center command">
                      <span>1. Command</span>
                      <select
                        value={presetCommandId}
                        onChange={(event) => {
                          setPresetCommandId(event.target.value as RunCenterCommandId);
                          setShowRunCenterDisabledReason(false);
                        }}
                        aria-label="Run Center command"
                      >
                        <option value="">Select command…</option>
                        <option value="diagnose">diagnose</option>
                        <option value="dryRunAll">dryRunAll</option>
                        <option value="dryRunTask">dryRunTask</option>
                      </select>
                    </label>
                    {presetCommandId === "dryRunTask" && (
                      <label className="search-control" aria-label="Run Center tasks">
                        <Search className="w-4 h-4" />
                        <input
                          type="text"
                          placeholder="2. Task names, comma-separated"
                          value={presetTaskInput}
                          onChange={(event) => setPresetTaskInput(event.target.value)}
                          aria-label="Run Center task names comma separated"
                        />
                      </label>
                    )}
                    <label className="select-control" aria-label="Preset name">
                      <span>Preset Name</span>
                      <input
                        type="text"
                        value={presetName}
                        maxLength={MAX_PRESET_NAME_LENGTH}
                        onChange={(event) => setPresetName(event.target.value)}
                        aria-label="Preset name"
                      />
                    </label>
                  </div>
                  {!runCenterModel.summary.commandId && (
                    <section className="empty-state-card" aria-live="polite" aria-label="Run Center empty state">
                      <h3>Choose a command to begin</h3>
                      <p className="meta-muted">
                        Run actions stay disabled until you pick a command. This prevents accidental launches with incomplete
                        configuration.
                      </p>
                    </section>
                  )}
                  <section className="empty-state-card" aria-label="Run Center configuration summary">
                    <h3>3. Review configuration</h3>
                    <dl className="inspector-grid">
                      <dt>Command</dt>
                      <dd>{runCenterModel.summary.commandId || "Not selected"}</dd>
                      <dt>Tasks</dt>
                      <dd>
                        {runCenterModel.summary.taskCount > 0
                          ? `${runCenterModel.summary.taskCount} (${runCenterModel.summary.orderedTaskNames.join(", ")})`
                          : "None"}
                      </dd>
                      <dt>Dry Run</dt>
                      <dd>{runCenterModel.summary.dryRun ? "true" : "false"}</dd>
                      <dt>Toggles</dt>
                      <dd>
                        readOnly={String(runCenterModel.summary.toggles.readOnly)} highContrast=
                        {String(runCenterModel.summary.toggles.highContrast)} reducedMotion=
                        {String(runCenterModel.summary.toggles.reducedMotion)}
                      </dd>
                    </dl>
                    {!runCenterModel.canRun && showRunCenterDisabledReason && (
                      <p id="run-center-disabled-reason" className="meta-muted" aria-live="polite">
                        Why disabled: {runCenterModel.disabledReason}
                      </p>
                    )}
                  </section>
                  <div className="sessions-export-center">
                    <button
                      className="btn-theme"
                      type="button"
                      onClick={() => void runFromRunCenter()}
                      disabled={!runCenterModel.canRun}
                      aria-label="Run current configuration"
                      aria-describedby={!runCenterModel.canRun ? "run-center-disabled-reason" : undefined}
                    >
                      <Play className="w-4 h-4" /> 4. Run Current Configuration
                    </button>
                    {!runCenterModel.canRun && (
                      <button
                        className="btn-muted"
                        type="button"
                        onClick={() => setShowRunCenterDisabledReason((previous) => !previous)}
                        aria-label="Explain why run is disabled"
                        aria-expanded={showRunCenterDisabledReason}
                        aria-controls="run-center-disabled-reason"
                      >
                        <CircleHelp className="w-4 h-4" /> Why is this disabled?
                      </button>
                    )}
                    <button className="btn-theme" type="button" onClick={savePresetFromInputs} aria-label="Save preset">
                      <FileJson2 className="w-4 h-4" /> Save Preset
                    </button>
                    <button
                      className="btn-muted"
                      type="button"
                      onClick={() => void repeatLastRun()}
                      disabled={!lastRunConfig || isBusy}
                      aria-label="Repeat last run configuration"
                    >
                      <Activity className="w-4 h-4" /> Repeat Last Run
                    </button>
                  </div>
                  <div className="sessions-filters">
                    <label className="select-control" aria-label="Select existing preset">
                      <span>Saved</span>
                      <select
                        value={selectedPreset?.id ?? ""}
                        onChange={(event) => setSelectedPresetId(event.target.value || null)}
                        disabled={presets.length === 0}
                      >
                        {presets.length === 0 ? (
                          <option value="">No presets saved</option>
                        ) : (
                          presets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name} ({preset.config.commandId})
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                    <div className="sessions-export-center">
                      <button
                        className="btn-muted"
                        type="button"
                        onClick={applySelectedPresetToRunCenter}
                        disabled={!selectedPreset}
                        aria-label="Apply selected preset to run center"
                      >
                        <ChevronRight className="w-4 h-4" /> Apply Preset
                      </button>
                      <button
                        className="btn-theme"
                        type="button"
                        onClick={() => void runSelectedPreset()}
                        disabled={!selectedPreset || isBusy}
                        aria-label="Run selected preset"
                      >
                        <Play className="w-4 h-4" /> Run Preset
                      </button>
                      <button
                        className="btn-muted"
                        type="button"
                        onClick={duplicateSelectedPreset}
                        disabled={!selectedPreset}
                        aria-label="Duplicate selected preset"
                      >
                        <Copy className="w-4 h-4" /> Duplicate Preset
                      </button>
                      <button className="btn-muted" type="button" onClick={exportPresets} disabled={presets.length === 0}>
                        <Download className="w-4 h-4" /> Export Presets
                      </button>
                      <button className="btn-muted" type="button" onClick={triggerPresetImport}>
                        <FileJson2 className="w-4 h-4" /> Import Presets
                      </button>
                      <input
                        ref={presetsImportInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="sr-only"
                        onChange={(event) => void onPresetImportSelected(event)}
                      />
                    </div>
                  </div>
                  {selectedPreset && (
                    <p className="meta-muted" aria-live="polite">
                      Selected preset: {selectedPreset.name} | command {selectedPreset.config.commandId}
                      {selectedPreset.config.commandId === "dryRunTask"
                        ? ` | tasks ${selectedPreset.config.taskNames.join(", ")}`
                        : ""}
                    </p>
                  )}
                </section>

                <section className="sessions-panel" aria-label="Workspace layout controls">
                  <div className="sessions-header">
                    <h3>Workspace</h3>
                    <p className="meta-muted">Switch layout focus without changing execution behavior.</p>
                  </div>
                  <div className="sessions-export-center">
                    <button
                      type="button"
                      className={`btn-muted ${workspaceMode === "balanced" ? "workspace-chip-active" : ""}`}
                      onClick={() => setWorkspaceMode("balanced")}
                      aria-pressed={workspaceMode === "balanced"}
                    >
                      Balanced
                    </button>
                    <button
                      type="button"
                      className={`btn-muted ${workspaceMode === "focus-output" ? "workspace-chip-active" : ""}`}
                      onClick={() => setWorkspaceMode("focus-output")}
                      aria-pressed={workspaceMode === "focus-output"}
                    >
                      Focus Output
                    </button>
                    <button
                      type="button"
                      className={`btn-muted ${workspaceMode === "focus-tasks" ? "workspace-chip-active" : ""}`}
                      onClick={() => setWorkspaceMode("focus-tasks")}
                      aria-pressed={workspaceMode === "focus-tasks"}
                    >
                      Focus Tasks
                    </button>
                    <button
                      type="button"
                      className={`btn-muted ${workspaceMode === "focus-inspector" ? "workspace-chip-active" : ""}`}
                      onClick={() => setWorkspaceMode("focus-inspector")}
                      aria-pressed={workspaceMode === "focus-inspector"}
                    >
                      Focus Inspector
                    </button>
                  </div>
                </section>

                <section className="sessions-panel" aria-label="Saved views">
                  <div className="sessions-header">
                    <h3>Saved Views</h3>
                    <p className="meta-muted">Save a deterministic URL snapshot of current view, filters, and layout.</p>
                  </div>
                  <div className="sessions-filters">
                    <label className="select-control" aria-label="Saved view name">
                      <span>Name</span>
                      <input
                        type="text"
                        value={savedViewName}
                        maxLength={64}
                        onChange={(event) => setSavedViewName(event.target.value)}
                        aria-label="Saved view name"
                      />
                    </label>
                    <div className="sessions-export-center">
                      <button type="button" className="btn-theme" onClick={saveCurrentView} aria-label="Save current view">
                        <FileJson2 className="w-4 h-4" /> Save View
                      </button>
                      <button type="button" className="btn-muted" onClick={() => void copyCurrentDeepLink()}>
                        <Link2 className="w-4 h-4" /> Copy Current Link
                      </button>
                    </div>
                  </div>
                  {savedViews.length === 0 ? (
                    <section className="empty-state-card" aria-live="polite" aria-label="Saved views empty state">
                      <h3>No saved views yet</h3>
                      <p className="meta-muted">
                        Save the current workspace URL to quickly restore view, selected session/event, and filters.
                      </p>
                    </section>
                  ) : (
                    <div className="sessions-list" role="list" aria-label="Saved views list">
                      {savedViews.map((savedView) => (
                        <div key={`saved-view-${savedView.name}`} className="session-row" role="listitem">
                          <button
                            type="button"
                            className="session-row-button"
                            onClick={() => openSavedView(savedView)}
                            aria-label={`Open saved view ${savedView.name}`}
                          >
                            <span className="session-row-heading">
                              <strong>{savedView.name}</strong>
                            </span>
                            <span className="session-row-meta">{savedView.url}</span>
                          </button>
                          <div className="sessions-export-center">
                            <button
                              type="button"
                              className="btn-muted session-pin-btn"
                              onClick={() => void copySavedViewLink(savedView)}
                              aria-label={`Copy link for ${savedView.name}`}
                            >
                              <Link2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              className="btn-muted session-pin-btn"
                              onClick={() => removeSavedView(savedView.name)}
                              aria-label={`Delete saved view ${savedView.name}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
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
                {!isBusy && selectedTasks.length === 0 && (
                  <p className="meta-muted" aria-live="polite">
                    Run Selected Tasks is disabled until you select at least one task.
                  </p>
                )}

                {taskLoadError && (
                  <section className="empty-state-card" aria-live="polite" aria-label="Task loading failure guidance">
                    <h3>Cannot load tasks</h3>
                    <p className="meta-muted">{taskLoadError}</p>
                    <p className="meta-muted">
                      Task discovery failed. Check `nlx list-tasks` availability, then retry task loading or run diagnose.
                    </p>
                    <div className="empty-state-actions">
                      <button className="btn-muted" type="button" onClick={() => void loadTasks()} disabled={isBusy}>
                        Refresh Task List
                      </button>
                      <button className="btn-theme" type="button" onClick={() => void runDiagnose()} disabled={isBusy}>
                        <Activity className="w-4 h-4" /> Run Diagnose
                      </button>
                    </div>
                  </section>
                )}

                <p className="meta-muted" aria-live="polite">
                  Showing {visibleTaskRows.length} of {filteredTaskRows.length} task(s).
                </p>
                <p className="meta-muted">Latest task result rows: {taskResults.length}</p>

                {!taskLoadError && knownTasks.length === 0 ? (
                  <section className="empty-state-card" aria-live="polite" aria-label="Task list empty state">
                    <h3>No tasks loaded yet</h3>
                    <p className="meta-muted">
                      Run a refresh to load tasks from NLX. If it remains empty, run diagnose and inspect the output panel.
                    </p>
                    <div className="empty-state-actions">
                      <button className="btn-muted" type="button" onClick={() => void loadTasks()} disabled={isBusy}>
                        Refresh Task List
                      </button>
                      <button className="btn-theme" type="button" onClick={() => void runDiagnose()} disabled={isBusy}>
                        <Activity className="w-4 h-4" /> Run Diagnose
                      </button>
                    </div>
                  </section>
                ) : filteredTaskRows.length === 0 ? (
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
                        <label className="select-control" aria-label="Compare selected session with another session">
                          <span>Compare</span>
                          <select
                            value={compareSessionId ?? ""}
                            onChange={(event) => setCompareSessionId(event.target.value || null)}
                            disabled={compareSessionOptions.length === 0}
                          >
                            <option value="">None</option>
                            {compareSessionOptions.map((session) => (
                              <option key={session.id} value={session.id}>
                                {session.label} ({formatTimestamp(session.startedAt)})
                              </option>
                            ))}
                          </select>
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
                        <button
                          className="btn-theme"
                          type="button"
                          onClick={exportDeterministicReportBundle}
                          disabled={!selectedSession}
                          aria-label="Generate deterministic session report bundle"
                        >
                          <FileJson2 className="w-4 h-4" /> Generate Report
                        </button>
                        <button
                          className="btn-theme"
                          type="button"
                          onClick={openBundleExport}
                          aria-haspopup="dialog"
                          aria-expanded={bundleExportOpen}
                          aria-label="Open investigation bundle export"
                        >
                          <Download className="w-4 h-4" /> Bundle Export
                        </button>
                      </div>

                      {runSessions.length === 0 ? (
                        <section className="empty-state-card" aria-live="polite" aria-label="Run sessions empty state">
                          <h3>No run sessions yet</h3>
                          <p className="meta-muted">
                            Sessions are created after running diagnose or a dry-run command.
                          </p>
                          <div className="empty-state-actions">
                            <button className="btn-theme" type="button" onClick={() => void runDiagnose()} disabled={isBusy}>
                              <Activity className="w-4 h-4" /> Run Diagnose
                            </button>
                            <button className="btn-muted" type="button" onClick={() => void runDryRunSweep()} disabled={isBusy}>
                              <Play className="w-4 h-4" /> Run Dry-Run Sweep
                            </button>
                          </div>
                        </section>
                      ) : filteredSessions.length === 0 ? (
                        <section className="empty-state-card" aria-live="polite" aria-label="Run sessions filtered empty state">
                          <h3>No sessions match filters</h3>
                          <p className="meta-muted">Adjust command, badge, range, or degraded-only filters to continue.</p>
                        </section>
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
                  <label className="select-control" aria-label="Group timeline by">
                    <span>Group</span>
                    <select
                      value={timelineGroupMode}
                      onChange={(event) => setTimelineGroupMode(event.target.value as TimelineGroupMode)}
                      aria-label="Timeline grouping mode"
                    >
                      <option value="chronological">Chronological</option>
                      <option value="severity">Severity</option>
                      <option value="phase">Phase</option>
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

                <section className="empty-state-card" aria-label="Session summary">
                  <h3>Session Summary</h3>
                  <p className="meta-muted">
                    Events: {timelineSummary.totalEvents} | Duration: {formatDuration(timelineSummary.totalDurationMs)}
                  </p>
                  <p className="meta-muted">
                    Severity: PASS {timelineSummary.severityCounts.PASS} / WARN {timelineSummary.severityCounts.WARN} / FAIL{" "}
                    {timelineSummary.severityCounts.FAIL} / RUNNING {timelineSummary.severityCounts.RUNNING}
                  </p>
                  <p className="meta-muted">
                    Badges:{" "}
                    {timelineSummary.badgeDistribution.length === 0
                      ? "n/a"
                      : timelineSummary.badgeDistribution.map((entry) => `${entry.badge} ${entry.count}`).join(", ")}
                  </p>
                  <p className="meta-muted">
                    Reasons:{" "}
                    {timelineSummary.reasonCodeDistribution.length === 0
                      ? "n/a"
                      : timelineSummary.reasonCodeDistribution.map((entry) => `${entry.reasonCode} ${entry.count}`).join(", ")}
                  </p>
                </section>

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
                      {selectedSession.events.length === 0 && (
                        <p className="meta-muted">
                          No events captured for this session. This can happen when runs are canceled, timeout early, or return no
                          timeline events.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="meta-muted">Select an event to inspect run details.</p>
                  )}
                </section>

                {sessionComparison && (
                  <section className="empty-state-card" aria-label="Session compare summary">
                    <h3>
                      Compare: {sessionComparison.baseSessionId} vs {sessionComparison.targetSessionId}
                    </h3>
                    <p className="meta-muted">
                      Metadata changes: command {sessionComparison.metadata.commandId.base} →{" "}
                      {sessionComparison.metadata.commandId.target}, badge {sessionComparison.metadata.badge.base} →{" "}
                      {sessionComparison.metadata.badge.target}, reason {sessionComparison.metadata.reasonCode.base} →{" "}
                      {sessionComparison.metadata.reasonCode.target}
                    </p>
                    <p className="meta-muted">
                      Event delta: {sessionComparison.eventCount.delta} | Severity delta: INFO{" "}
                      {sessionComparison.severityCount.delta.INFO}, WARN {sessionComparison.severityCount.delta.WARN}, ERROR{" "}
                      {sessionComparison.severityCount.delta.ERROR}
                    </p>
                    <details>
                      <summary>New errors introduced ({sessionComparison.newErrorsIntroduced.length})</summary>
                      {sessionComparison.newErrorsIntroduced.length === 0 ? (
                        <p className="meta-muted">No new error fingerprints introduced.</p>
                      ) : (
                        <ul className="session-event-list">
                          {sessionComparison.newErrorsIntroduced.map((entry) => (
                            <li key={entry.fingerprint}>
                              <span>{entry.fingerprint}</span>
                              <span>{entry.reasonCode}</span>
                              <p>{entry.message}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </section>
                )}

                {filteredHistory.length === 0 ? (
                  <section className="empty-state-card" aria-live="polite" aria-label="Output timeline empty state">
                    <h3>No events captured</h3>
                    <p className="meta-muted">
                      {selectedSession
                        ? "The selected session has no matching timeline events for current filters."
                        : "Run diagnose or dry-run to populate timeline events."}
                    </p>
                    <p className="meta-muted">
                      Common causes: command timeout, cancellation, or filters/search excluding current output.
                    </p>
                  </section>
                ) : (
                  <div className="timeline-list" role="list" aria-label="Command timeline">
                    {groupedTimeline.map((section) => (
                      <section key={section.key} className="timeline-group-section" aria-label={`Timeline group ${section.label}`}>
                        {timelineGroupMode !== "chronological" && (
                          <h3 className="timeline-group-title">
                            {section.label} ({section.items.length})
                          </h3>
                        )}
                        {section.items.map((event) => {
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
                      </section>
                    ))}
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

      {bundleExportOpen && (
        <div className="shortcut-overlay" role="presentation">
          <div
            ref={bundleExportDialogRef}
            className="shortcut-dialog glass-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bundle-export-title"
            onKeyDown={handleBundleExportDialogKeyDown}
          >
            <header className="shortcut-header">
              <h2 id="bundle-export-title" className="section-title">
                Investigation Bundle Export
              </h2>
              <button ref={bundleExportCloseRef} className="btn-muted" type="button" onClick={closeBundleExport}>
                <X className="w-4 h-4" /> Close
              </button>
            </header>

            <div className="help-body">
              <section className="help-section">
                <h3>Preset Source</h3>
                <label className="select-control">
                  <span>Source</span>
                  <select
                    value={bundlePresetSelection}
                    onChange={(event) => setBundlePresetSelection(event.target.value as BundlePresetSelection)}
                    aria-label="Bundle preset source"
                  >
                    <option value="none">None</option>
                    <option value="preset" disabled={!selectedPreset}>
                      Selected preset
                    </option>
                    <option value="current" disabled={!runCenterModel.config}>
                      Current runner config
                    </option>
                  </select>
                </label>
              </section>

              <section className="help-section">
                <h3>Sessions</h3>
                {runSessions.length === 0 ? (
                  <p className="meta-muted">No sessions available.</p>
                ) : (
                  <div className="sessions-list" role="list" aria-label="Bundle session selection">
                    {sortRunSessions(runSessions).map((session) => {
                      const checked = bundleSessionIds.includes(session.id);
                      return (
                        <label key={`bundle-session-${session.id}`} className="session-toggle">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => toggleBundleSessionSelection(session.id, event.target.checked)}
                          />
                          <span>
                            {session.label} ({session.id})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="help-section">
                <h3>Saved Views</h3>
                {savedViews.length === 0 ? (
                  <p className="meta-muted">No saved views available.</p>
                ) : (
                  <div className="sessions-list" role="list" aria-label="Bundle saved view selection">
                    {savedViews.map((view) => {
                      const checked = bundleViewNames.includes(view.name);
                      return (
                        <label key={`bundle-view-${view.name}`} className="session-toggle">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => toggleBundleViewSelection(view.name, event.target.checked)}
                          />
                          <span>{view.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="help-section">
                <h3>Preview</h3>
                <p className="meta-muted">
                  sessions={selectedBundleSessions.length} views={selectedBundleViews.length} preset=
                  {bundlePresetSelection}
                </p>
                <div className="settings-actions">
                  <button className="btn-theme" type="button" onClick={exportInvestigationBundle}>
                    <Download className="w-4 h-4" /> Download Bundle JSON
                  </button>
                </div>
              </section>

              <section className="help-section">
                <h3>Import Bundle</h3>
                <p className="meta-muted">
                  Paste a previously exported bundle JSON. Validation is strict and rejects unredacted-looking content.
                </p>
                <textarea
                  className="bundle-import-textarea"
                  value={bundleImportRaw}
                  onChange={(event) => {
                    setBundleImportRaw(event.target.value);
                    setBundleImportErrors([]);
                    setBundleImportPreview(null);
                    setValidatedBundle(null);
                  }}
                  placeholder="Paste investigation bundle JSON here..."
                  aria-label="Bundle import JSON"
                />
                <div className="settings-actions">
                  <button className="btn-muted" type="button" onClick={validateBundleImport}>
                    <CheckCircle2 className="w-4 h-4" /> Validate
                  </button>
                  <button className="btn-theme" type="button" onClick={importValidatedBundle} disabled={!validatedBundle}>
                    <Download className="w-4 h-4" /> Import
                  </button>
                </div>
                {bundleImportPreview && (
                  <p className="meta-muted">
                    kind={bundleImportPreview.bundleKind} presets={bundleImportPreview.presetCandidates} sessions=
                    {bundleImportPreview.sessionCandidates} views={bundleImportPreview.viewCandidates} duplicates=
                    {bundleImportPreview.duplicatePresets + bundleImportPreview.duplicateSessions}
                  </p>
                )}
                {bundleImportErrors.length > 0 && (
                  <ul className="bundle-validation-list">
                    {bundleImportErrors.map((error) => (
                      <li key={`${error.code}-${error.path}-${error.message}`}>
                        <strong>{error.code}</strong> <span>{error.path}</span> {error.message}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

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

      {consoleHelpOpen && (
        <div className="shortcut-overlay" role="presentation">
          <div
            ref={consoleHelpDialogRef}
            className="shortcut-dialog glass-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="console-help-title"
            onKeyDown={handleConsoleHelpDialogKeyDown}
          >
            <header className="shortcut-header">
              <h2 id="console-help-title" className="section-title">
                Console Help
              </h2>
              <button ref={consoleHelpCloseRef} className="btn-muted" type="button" onClick={closeConsoleHelp}>
                <X className="w-4 h-4" /> Close
              </button>
            </header>

            <div className="help-body">
              <section className="help-section">
                <h3>How Runs Work</h3>
                <ul className="shortcut-list">
                  <li>
                    <span>Single-flight: only one command can run at a time. Additional requests return busy guidance.</span>
                  </li>
                  <li>
                    <span>Timeouts map to DEGRADED so the UI stays deterministic without crashing.</span>
                  </li>
                  <li>
                    <span>Outputs shown and exported from the GUI are redacted before render and persistence.</span>
                  </li>
                </ul>
              </section>

              <section className="help-section">
                <h3>Local Storage</h3>
                <p className="meta-muted">
                  Sessions are stored in browser localStorage for quick restore. Use clear controls below to reset local GUI state.
                </p>
                <div className="settings-actions">
                  <button className="btn-muted" type="button" onClick={() => void copyConsoleDiagnostics()}>
                    <Copy className="w-4 h-4" /> Copy Diagnostics
                  </button>
                  <button className="btn-muted" type="button" onClick={exportGuiSettings}>
                    <Download className="w-4 h-4" /> Export Settings
                  </button>
                  <button className="btn-muted" type="button" onClick={clearGuiSettingsWithConfirm}>
                    <Trash2 className="w-4 h-4" /> Clear Settings
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
