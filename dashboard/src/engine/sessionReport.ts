import { buildEventFingerprint } from "./eventFingerprint";
import { redactOutput } from "./redaction";
import type { RunSession, RunSessionEvent } from "./runSessions";
import { compareRunSessions, type SessionComparison } from "./sessionCompare";

export const SESSION_REPORT_SCHEMA_VERSION = 1;

export interface SessionReportBundle {
  json: string;
  markdown: string;
}

interface SessionReportEvent {
  id: string;
  ts: string;
  offsetMs: number;
  level: RunSessionEvent["level"];
  fingerprint: string;
  msg: string;
}

interface SessionReportPayload {
  schemaVersion: number;
  reportType: "session";
  guiVersion: string;
  session: {
    id: string;
    commandId: RunSession["commandId"];
    taskName: string | null;
    badge: RunSession["badge"];
    reasonCode: RunSession["reasonCode"];
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    durationLabel: string;
    degraded: boolean;
    redacted: true;
    note: string;
    events: SessionReportEvent[];
    taskResults: RunSession["taskResults"];
  };
}

interface SessionCompareReportPayload {
  schemaVersion: number;
  reportType: "compare";
  guiVersion: string;
  comparison: SessionComparison;
}

function stableSortEvents(events: RunSessionEvent[]): RunSessionEvent[] {
  return [...events].sort((left, right) => {
    if (left.offsetMs !== right.offsetMs) {
      return left.offsetMs - right.offsetMs;
    }
    return left.id.localeCompare(right.id);
  });
}

function stableSortTaskResults(session: RunSession): RunSession["taskResults"] {
  return [...session.taskResults].sort((left, right) => {
    const taskNameCmp = left.taskName.localeCompare(right.taskName);
    if (taskNameCmp !== 0) {
      return taskNameCmp;
    }
    const statusCmp = left.status.localeCompare(right.status);
    if (statusCmp !== 0) {
      return statusCmp;
    }
    return left.reason.localeCompare(right.reason);
  });
}

function severityForEventLevel(level: RunSessionEvent["level"]): "INFO" | "WARN" | "ERROR" {
  if (level === "error") {
    return "ERROR";
  }
  if (level === "warn") {
    return "WARN";
  }
  return "INFO";
}

function toSessionReportPayload(session: RunSession, guiVersion: string): SessionReportPayload {
  const events = stableSortEvents(session.events).map((event) => ({
    id: event.id,
    ts: event.ts,
    offsetMs: event.offsetMs,
    level: event.level,
    fingerprint: buildEventFingerprint({
      severity: severityForEventLevel(event.level),
      label: session.label,
      message: event.msg,
      reasonCode: session.reasonCode,
    }),
    msg: redactOutput(event.msg),
  }));

  return {
    schemaVersion: SESSION_REPORT_SCHEMA_VERSION,
    reportType: "session",
    guiVersion,
    session: {
      id: session.id,
      commandId: session.commandId,
      taskName: session.taskName ? redactOutput(session.taskName) : null,
      badge: session.badge,
      reasonCode: session.reasonCode,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      durationMs: session.durationMs,
      durationLabel: session.durationLabel,
      degraded: session.degraded,
      redacted: true,
      note: redactOutput(session.note),
      events,
      taskResults: stableSortTaskResults(session).map((item) => ({
        taskName: redactOutput(item.taskName),
        status: item.status,
        reason: redactOutput(item.reason),
      })),
    },
  };
}

function toCompareReportPayload(base: RunSession, target: RunSession, guiVersion: string): SessionCompareReportPayload {
  return {
    schemaVersion: SESSION_REPORT_SCHEMA_VERSION,
    reportType: "compare",
    guiVersion,
    comparison: compareRunSessions(base, target),
  };
}

function buildSessionMarkdown(payload: SessionReportPayload): string {
  const lines: string[] = [];
  lines.push("# NextLevelApex Session Report");
  lines.push("");
  lines.push(`- GUI Version: ${payload.guiVersion}`);
  lines.push(`- Schema Version: ${payload.schemaVersion}`);
  lines.push(`- Session ID: ${payload.session.id}`);
  lines.push(`- Command: ${payload.session.commandId}`);
  lines.push(`- Task: ${payload.session.taskName ?? "n/a"}`);
  lines.push(`- Badge: ${payload.session.badge}`);
  lines.push(`- Reason: ${payload.session.reasonCode}`);
  lines.push(`- Started: ${payload.session.startedAt}`);
  lines.push(`- Finished: ${payload.session.finishedAt}`);
  lines.push(`- Duration: ${payload.session.durationLabel}`);
  lines.push(`- Degraded: ${payload.session.degraded ? "yes" : "no"}`);
  lines.push("- Redacted: yes");
  lines.push("");
  lines.push("## Events");
  if (payload.session.events.length === 0) {
    lines.push("- none");
  } else {
    for (const event of payload.session.events) {
      lines.push(`- +${event.offsetMs}ms [${event.level}] (${event.fingerprint}) ${event.msg}`);
    }
  }
  lines.push("");
  lines.push("## Task Results");
  if (payload.session.taskResults.length === 0) {
    lines.push("- none");
  } else {
    for (const item of payload.session.taskResults) {
      lines.push(`- ${item.taskName} [${item.status}] ${item.reason}`);
    }
  }
  return lines.join("\n");
}

function buildCompareMarkdown(payload: SessionCompareReportPayload): string {
  const lines: string[] = [];
  lines.push("# NextLevelApex Session Comparison Report");
  lines.push("");
  lines.push(`- GUI Version: ${payload.guiVersion}`);
  lines.push(`- Schema Version: ${payload.schemaVersion}`);
  lines.push(`- Base Session: ${payload.comparison.baseSessionId}`);
  lines.push(`- Target Session: ${payload.comparison.targetSessionId}`);
  lines.push(`- Event Delta: ${payload.comparison.eventCount.delta}`);
  lines.push(
    `- Severity Delta: INFO ${payload.comparison.severityCount.delta.INFO}, WARN ${payload.comparison.severityCount.delta.WARN}, ERROR ${payload.comparison.severityCount.delta.ERROR}`,
  );
  lines.push("");
  lines.push("## Metadata Diff");
  lines.push(
    `- Command: ${payload.comparison.metadata.commandId.base} -> ${payload.comparison.metadata.commandId.target}`,
  );
  lines.push(`- Badge: ${payload.comparison.metadata.badge.base} -> ${payload.comparison.metadata.badge.target}`);
  lines.push(
    `- Reason Code: ${payload.comparison.metadata.reasonCode.base} -> ${payload.comparison.metadata.reasonCode.target}`,
  );
  lines.push(
    `- Duration Ms: ${payload.comparison.metadata.durationMs.base} -> ${payload.comparison.metadata.durationMs.target}`,
  );
  lines.push("");
  lines.push("## New Errors Introduced");
  if (payload.comparison.newErrorsIntroduced.length === 0) {
    lines.push("- none");
  } else {
    for (const item of payload.comparison.newErrorsIntroduced) {
      lines.push(`- ${item.fingerprint}: ${item.message} (${item.reasonCode})`);
    }
  }
  return lines.join("\n");
}

export function buildSessionReportBundle(session: RunSession, guiVersion: string): SessionReportBundle {
  const payload = toSessionReportPayload(session, guiVersion);
  return {
    json: JSON.stringify(payload, null, 2),
    markdown: buildSessionMarkdown(payload),
  };
}

export function buildSessionCompareReportBundle(
  base: RunSession,
  target: RunSession,
  guiVersion: string,
): SessionReportBundle {
  const payload = toCompareReportPayload(base, target, guiVersion);
  return {
    json: JSON.stringify(payload, null, 2),
    markdown: buildCompareMarkdown(payload),
  };
}
