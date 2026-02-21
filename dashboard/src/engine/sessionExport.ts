import { redactOutput } from "./redaction";
import type { RunSession } from "./runSessions";

export interface SessionExportEvent {
  id: string;
  ts: string;
  offsetMs: number;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
}

export interface SessionExportRecord {
  id: string;
  commandId: RunSession["commandId"];
  taskName: string | null;
  label: string;
  badge: RunSession["badge"];
  reasonCode: RunSession["reasonCode"];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  durationLabel: string;
  degraded: boolean;
  redacted: boolean;
  severity: RunSession["severity"];
  statusClass: RunSession["statusClass"];
  pinned: boolean;
  note: string;
  taskResults: RunSession["taskResults"];
  events: SessionExportEvent[];
}

function sanitizeSessionForExport(session: RunSession): SessionExportRecord {
  const orderedEvents = [...session.events].sort((left, right) => {
    if (left.offsetMs !== right.offsetMs) {
      return left.offsetMs - right.offsetMs;
    }
    return left.id.localeCompare(right.id);
  });

  return {
    id: session.id,
    commandId: session.commandId,
    taskName: session.taskName,
    label: redactOutput(session.label),
    badge: session.badge,
    reasonCode: session.reasonCode,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    durationMs: session.durationMs,
    durationLabel: session.durationLabel,
    degraded: session.degraded,
    redacted: true,
    severity: session.severity,
    statusClass: session.statusClass,
    pinned: session.pinned,
    note: redactOutput(session.note),
    taskResults: session.taskResults.map((item) => ({
      taskName: redactOutput(item.taskName),
      status: item.status,
      reason: redactOutput(item.reason),
    })),
    events: orderedEvents.map((item) => ({
      id: item.id,
      ts: item.ts,
      offsetMs: item.offsetMs,
      level: item.level,
      msg: redactOutput(item.msg),
    })),
  };
}

function sortSessionsForExport(sessions: RunSession[]): RunSession[] {
  return [...sessions].sort((left, right) => {
    const leftMs = Date.parse(left.startedAt);
    const rightMs = Date.parse(right.startedAt);
    if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs) && rightMs !== leftMs) {
      return rightMs - leftMs;
    }
    return right.id.localeCompare(left.id);
  });
}

export function buildSessionExportJson(session: RunSession): string {
  return JSON.stringify(sanitizeSessionForExport(session), null, 2);
}

export function buildSessionBundleExportJson(sessions: RunSession[]): string {
  const ordered = sortSessionsForExport(sessions).map((item) => sanitizeSessionForExport(item));
  return JSON.stringify(ordered, null, 2);
}

export function buildSessionOperatorReport(session: RunSession): string {
  const payload = sanitizeSessionForExport(session);
  const lines: string[] = [];
  lines.push("NextLevelApex Operator Report");
  lines.push(`Session ID: ${payload.id}`);
  lines.push(`Started: ${payload.startedAt}`);
  lines.push(`Finished: ${payload.finishedAt}`);
  lines.push(`Command: ${payload.commandId}`);
  lines.push(`Task: ${payload.taskName ?? "n/a"}`);
  lines.push(`Badge: ${payload.badge}`);
  lines.push(`Reason: ${payload.reasonCode}`);
  lines.push(`Duration: ${payload.durationLabel}`);
  lines.push(`Degraded: ${payload.degraded ? "yes" : "no"}`);
  lines.push("Redacted: yes");
  lines.push("");
  lines.push("Timeline Events:");
  for (const event of payload.events) {
    lines.push(`- +${event.offsetMs}ms [${event.level}] ${event.msg}`);
  }
  lines.push("");
  lines.push("Task Results:");
  if (payload.taskResults.length === 0) {
    lines.push("- none");
  } else {
    for (const item of payload.taskResults) {
      lines.push(`- ${item.taskName} [${item.status}] ${item.reason}`);
    }
  }

  return lines.join("\n");
}
