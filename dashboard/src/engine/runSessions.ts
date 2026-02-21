import type { CommandId } from "./commandContract";
import { redactOutput } from "./redaction";
import type {
  CommandEvent,
  CommandReasonCode,
  CommandResponse,
  HealthBadge,
  TaskResult,
} from "./viewModel";

export const RUN_SESSIONS_STORAGE_KEY = "nlx.gui.runSessions.v1";
export const RUN_SESSIONS_SCHEMA_VERSION = 1;
export const MAX_STORED_RUN_SESSIONS = 25;

export type RunSessionSeverity = "PASS" | "WARN" | "FAIL";
export type RunSessionStatusClass = "status-pass" | "status-warn" | "status-fail";
export type RunSessionTimeRange = "today" | "7d" | "all";

export interface RunSessionEvent {
  id: string;
  ts: string;
  offsetMs: number;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
}

export interface RunSession {
  id: string;
  eventId: string;
  commandId: CommandId;
  taskName: string | null;
  label: string;
  badge: HealthBadge;
  reasonCode: CommandReasonCode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  durationLabel: string;
  degraded: boolean;
  redacted: boolean;
  severity: RunSessionSeverity;
  statusClass: RunSessionStatusClass;
  note: string;
  taskResults: TaskResult[];
  events: RunSessionEvent[];
  pinned: boolean;
}

export interface RunSessionStorageEnvelope {
  version: number;
  sessions: RunSession[];
}

export interface RunSessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RunSessionFilter {
  commandId: "ALL" | CommandId;
  badge: "ALL" | HealthBadge;
  degradedOnly: boolean;
  timeRange: RunSessionTimeRange;
}

export interface CreateRunSessionInput {
  eventId: string;
  commandId: CommandId;
  taskName?: string;
  label: string;
  note: string;
  startedAtMs: number;
  finishedAtIso: string;
  durationMs: number;
  result: CommandResponse;
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function normalizeDurationMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function formatDurationLabel(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function toSeverity(badge: HealthBadge): RunSessionSeverity {
  if (badge === "OK") {
    return "PASS";
  }
  if (badge === "DEGRADED") {
    return "WARN";
  }
  return "FAIL";
}

function toStatusClass(severity: RunSessionSeverity): RunSessionStatusClass {
  if (severity === "PASS") {
    return "status-pass";
  }
  if (severity === "WARN") {
    return "status-warn";
  }
  return "status-fail";
}

function sanitizeTaskResult(item: TaskResult): TaskResult {
  return {
    taskName: redactOutput(item.taskName),
    status: item.status,
    reason: redactOutput(item.reason),
  };
}

function sanitizeSessionEvent(item: RunSessionEvent): RunSessionEvent {
  return {
    ...item,
    msg: redactOutput(item.msg),
  };
}

function sanitizeSession(session: RunSession): RunSession {
  return {
    ...session,
    taskName: session.taskName ? redactOutput(session.taskName) : null,
    label: redactOutput(session.label),
    note: redactOutput(session.note),
    taskResults: session.taskResults.map((item) => sanitizeTaskResult(item)),
    events: session.events.map((item) => sanitizeSessionEvent(item)),
  };
}

function isTaskResult(value: unknown): value is TaskResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.taskName === "string" &&
    typeof raw.status === "string" &&
    typeof raw.reason === "string"
  );
}

function isRunSessionEvent(value: unknown): value is RunSessionEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.id === "string" &&
    typeof raw.ts === "string" &&
    typeof raw.offsetMs === "number" &&
    typeof raw.level === "string" &&
    typeof raw.msg === "string"
  );
}

function isRunSession(value: unknown): value is RunSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.id === "string" &&
    typeof raw.eventId === "string" &&
    typeof raw.commandId === "string" &&
    (typeof raw.taskName === "string" || raw.taskName === null) &&
    typeof raw.label === "string" &&
    typeof raw.badge === "string" &&
    typeof raw.reasonCode === "string" &&
    typeof raw.startedAt === "string" &&
    typeof raw.finishedAt === "string" &&
    typeof raw.durationMs === "number" &&
    typeof raw.durationLabel === "string" &&
    typeof raw.degraded === "boolean" &&
    typeof raw.redacted === "boolean" &&
    typeof raw.severity === "string" &&
    typeof raw.statusClass === "string" &&
    typeof raw.note === "string" &&
    typeof raw.pinned === "boolean" &&
    Array.isArray(raw.taskResults) &&
    raw.taskResults.every((item) => isTaskResult(item)) &&
    Array.isArray(raw.events) &&
    raw.events.every((item) => isRunSessionEvent(item))
  );
}

function normalizeRunSessions(sessions: RunSession[]): RunSession[] {
  return sortRunSessions(
    sessions.map((item) => sanitizeSession(item)),
  ).slice(0, MAX_STORED_RUN_SESSIONS);
}

function normalizedReasonCode(result: CommandResponse): CommandReasonCode {
  if (result.reasonCode) {
    return result.reasonCode;
  }
  return result.ok ? "SUCCESS" : "UNKNOWN";
}

function normalizedBadge(result: CommandResponse): HealthBadge {
  if (result.badge) {
    return result.badge;
  }
  return result.ok ? "OK" : "BROKEN";
}

function sessionEventsFromResponse(
  sessionId: string,
  startedAtMs: number,
  fallbackTs: string,
  result: CommandResponse,
  fallbackNote: string,
): RunSessionEvent[] {
  if (result.events && result.events.length > 0) {
    return result.events.map((item, index) => {
      const ts = item.ts || fallbackTs;
      const parsed = Date.parse(ts);
      const offsetMs = Number.isNaN(parsed) ? 0 : Math.max(0, parsed - startedAtMs);
      return {
        id: `${sessionId}-evt-${index}`,
        ts,
        offsetMs,
        level: item.level,
        msg: item.msg,
      };
    });
  }

  return [
    {
      id: `${sessionId}-evt-0`,
      ts: fallbackTs,
      offsetMs: 0,
      level: result.ok ? "info" : "error",
      msg: fallbackNote,
    },
  ];
}

export function createRunSessionId(startedAtMs: number, commandId: CommandId, collisionKey: string): string {
  const normalizedCollision = collisionKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(-12) || "run";
  return `${startedAtMs}-${commandId}-${normalizedCollision}`;
}

export function createRunSessionFromResult(input: CreateRunSessionInput): RunSession {
  const badge = normalizedBadge(input.result);
  const severity = toSeverity(badge);
  const reasonCode = normalizedReasonCode(input.result);
  const sessionId = createRunSessionId(input.startedAtMs, input.commandId, input.eventId);
  const durationMs = normalizeDurationMs(input.durationMs);
  const events = sessionEventsFromResponse(
    sessionId,
    input.startedAtMs,
    input.finishedAtIso,
    input.result,
    input.note,
  );

  return sanitizeSession({
    id: sessionId,
    eventId: input.eventId,
    commandId: input.commandId,
    taskName: input.taskName ?? null,
    label: input.label,
    badge,
    reasonCode,
    startedAt: toIso(input.startedAtMs),
    finishedAt: input.finishedAtIso,
    durationMs,
    durationLabel: formatDurationLabel(durationMs),
    degraded: badge !== "OK",
    redacted: input.result.redacted !== false,
    severity,
    statusClass: toStatusClass(severity),
    note: input.note,
    taskResults: (input.result.taskResults ?? []).map((item) => sanitizeTaskResult(item)),
    events,
    pinned: false,
  });
}

function badgeFromOutcome(outcome: CommandEvent["outcome"]): HealthBadge {
  if (outcome === "PASS") {
    return "OK";
  }
  if (outcome === "WARN") {
    return "DEGRADED";
  }
  return "BROKEN";
}

function taskNameFromEvent(event: CommandEvent): string | null {
  if (event.commandId !== "dryRunTask") {
    return null;
  }
  const prefix = "Dry-Run Task: ";
  if (event.label.startsWith(prefix)) {
    return event.label.slice(prefix.length).trim() || null;
  }
  return null;
}

export function createRunSessionFromCommandEvent(event: CommandEvent): RunSession {
  const startedAtMs = Date.parse(event.startedAt);
  const finishedAt = event.finishedAt ?? event.startedAt;
  const finishedAtMs = Date.parse(finishedAt);
  const safeStartedAtMs = Number.isNaN(startedAtMs) ? Date.now() : startedAtMs;
  const durationMs = event.durationMs ?? Math.max(0, (Number.isNaN(finishedAtMs) ? safeStartedAtMs : finishedAtMs) - safeStartedAtMs);
  const badge = badgeFromOutcome(event.outcome);
  const severity = toSeverity(badge);
  const sessionId = createRunSessionId(safeStartedAtMs, event.commandId, event.id);

  return sanitizeSession({
    id: sessionId,
    eventId: event.id,
    commandId: event.commandId,
    taskName: taskNameFromEvent(event),
    label: event.label,
    badge,
    reasonCode: "UNKNOWN",
    startedAt: event.startedAt,
    finishedAt,
    durationMs: normalizeDurationMs(durationMs),
    durationLabel: formatDurationLabel(normalizeDurationMs(durationMs)),
    degraded: badge !== "OK",
    redacted: true,
    severity,
    statusClass: toStatusClass(severity),
    note: event.note,
    taskResults: event.taskResults.map((item) => sanitizeTaskResult(item)),
    events: [
      {
        id: `${sessionId}-evt-0`,
        ts: event.startedAt,
        offsetMs: 0,
        level: badge === "BROKEN" ? "error" : badge === "DEGRADED" ? "warn" : "info",
        msg: event.note,
      },
    ],
    pinned: false,
  });
}

export function addRunSession(
  sessions: RunSession[],
  incoming: RunSession,
  maxItems = MAX_STORED_RUN_SESSIONS,
): RunSession[] {
  const next = [incoming, ...sessions.filter((session) => session.id !== incoming.id)];
  return normalizeRunSessions(next).slice(0, maxItems);
}

export function togglePinnedSession(sessions: RunSession[], sessionId: string): RunSession[] {
  return sortRunSessions(
    sessions.map((session) => (session.id === sessionId ? { ...session, pinned: !session.pinned } : session)),
  );
}

export function clearRunSessions(): RunSession[] {
  return [];
}

function startsOfToday(nowMs: number): number {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function filterRunSessions(
  sessions: RunSession[],
  filter: RunSessionFilter,
  nowMs = Date.now(),
): RunSession[] {
  return sessions.filter((session) => {
    if (filter.commandId !== "ALL" && session.commandId !== filter.commandId) {
      return false;
    }
    if (filter.badge !== "ALL" && session.badge !== filter.badge) {
      return false;
    }
    if (filter.degradedOnly && !session.degraded) {
      return false;
    }

    if (filter.timeRange === "today") {
      const sessionStartedAtMs = Date.parse(session.startedAt);
      if (Number.isNaN(sessionStartedAtMs) || sessionStartedAtMs < startsOfToday(nowMs)) {
        return false;
      }
    }

    if (filter.timeRange === "7d") {
      const sessionStartedAtMs = Date.parse(session.startedAt);
      if (Number.isNaN(sessionStartedAtMs) || sessionStartedAtMs < nowMs - 7 * 24 * 60 * 60 * 1000) {
        return false;
      }
    }

    return true;
  });
}

export function sortRunSessions(sessions: RunSession[]): RunSession[] {
  return [...sessions].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    const leftMs = Date.parse(left.startedAt);
    const rightMs = Date.parse(right.startedAt);
    if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs) && rightMs !== leftMs) {
      return rightMs - leftMs;
    }
    return right.id.localeCompare(left.id);
  });
}

export function storeRunSessions(storage: RunSessionStorageLike, sessions: RunSession[]): void {
  const payload: RunSessionStorageEnvelope = {
    version: RUN_SESSIONS_SCHEMA_VERSION,
    sessions: normalizeRunSessions(sessions),
  };
  storage.setItem(RUN_SESSIONS_STORAGE_KEY, JSON.stringify(payload));
}

function parseEnvelope(raw: string): RunSession[] {
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed)) {
    return normalizeRunSessions(parsed.filter((item) => isRunSession(item)));
  }

  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const envelope = parsed as Partial<RunSessionStorageEnvelope>;
  if (envelope.version !== RUN_SESSIONS_SCHEMA_VERSION || !Array.isArray(envelope.sessions)) {
    return [];
  }

  return normalizeRunSessions(envelope.sessions.filter((item) => isRunSession(item)));
}

export function loadRunSessions(storage: RunSessionStorageLike): RunSession[] {
  const raw = storage.getItem(RUN_SESSIONS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return parseEnvelope(raw);
  } catch {
    return [];
  }
}
