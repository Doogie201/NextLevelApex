import { redactOutput } from "./redaction";
import type { DiagnoseSummary } from "./diagnose";
import type { TaskResult } from "./taskResults";

export type ApiBadge = "OK" | "DEGRADED" | "BROKEN";

export type RunReasonCode =
  | "SUCCESS"
  | "VALIDATION"
  | "NOT_ALLOWED"
  | "TIMEOUT"
  | "SINGLE_FLIGHT"
  | "EXEC_ERROR"
  | "UNKNOWN";

export type RunEventLevel = "debug" | "info" | "warn" | "error";

export interface RunEvent {
  ts: string;
  level: RunEventLevel;
  msg: string;
}

export interface RunEnvelope {
  ok: boolean;
  badge: ApiBadge;
  reasonCode: RunReasonCode;
  commandId: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  stdout: string;
  stderr: string;
  events: RunEvent[];
  redacted: boolean;
  taskNames?: string[];
  taskResults?: TaskResult[];
  diagnose?: {
    summary: DiagnoseSummary;
    badge: ApiBadge;
  };
  exitCode?: number;
  timedOut?: boolean;
  errorType?: string;
}

interface BuildEnvelopeInput {
  ok: boolean;
  badge: ApiBadge;
  reasonCode: RunReasonCode;
  commandId: string;
  startedAt?: string;
  finishedAt?: string;
  stdout?: string;
  stderr?: string;
  events?: RunEvent[];
  taskResults?: TaskResult[];
  taskNames?: string[];
  diagnose?: RunEnvelope["diagnose"];
  exitCode?: number;
  timedOut?: boolean;
  errorType?: string;
}

interface RedactedField {
  text: string;
  changed: boolean;
}

function redactField(value: string | undefined): RedactedField {
  const source = value ?? "";
  const text = redactOutput(source);
  return { text, changed: text !== source };
}

function redactEvents(events: RunEvent[] | undefined): { events: RunEvent[]; changed: boolean } {
  const source = events ?? [];
  let changed = false;
  const redactedEvents = source.map((event) => {
    const redactedMessage = redactOutput(event.msg);
    if (redactedMessage !== event.msg) {
      changed = true;
    }
    return {
      ts: event.ts,
      level: event.level,
      msg: redactedMessage,
    };
  });
  return { events: redactedEvents, changed };
}

export function buildRunEnvelope(input: BuildEnvelopeInput): RunEnvelope {
  const startedAt = input.startedAt;
  const finishedAt = input.finishedAt ?? new Date().toISOString();
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const finishedMs = Date.parse(finishedAt);
  const durationMs =
    Number.isFinite(startedMs) && Number.isFinite(finishedMs) && finishedMs >= startedMs
      ? finishedMs - startedMs
      : undefined;

  const stdout = redactField(input.stdout);
  const stderr = redactField(input.stderr);
  const redactedEvents = redactEvents(input.events);

  return {
    ok: input.ok,
    badge: input.badge,
    reasonCode: input.reasonCode,
    commandId: input.commandId,
    startedAt,
    finishedAt,
    durationMs,
    stdout: stdout.text,
    stderr: stderr.text,
    events: redactedEvents.events,
    redacted: stdout.changed || stderr.changed || redactedEvents.changed,
    taskNames: input.taskNames,
    taskResults: input.taskResults,
    diagnose: input.diagnose,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    errorType: input.errorType,
  };
}

export function isRunEnvelope(value: unknown): value is RunEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.ok !== "boolean") {
    return false;
  }
  if (typeof candidate.badge !== "string") {
    return false;
  }
  if (typeof candidate.reasonCode !== "string") {
    return false;
  }
  if (typeof candidate.commandId !== "string") {
    return false;
  }
  if (typeof candidate.stdout !== "string" || typeof candidate.stderr !== "string") {
    return false;
  }
  if (!Array.isArray(candidate.events)) {
    return false;
  }
  if (typeof candidate.redacted !== "boolean") {
    return false;
  }
  return true;
}
