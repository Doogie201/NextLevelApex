import { redactOutput } from "./redaction";
import type { RunSession, RunSessionEvent } from "./runSessions";
import { buildEventFingerprint, type FingerprintSeverity } from "./eventFingerprint";

export interface SessionSeverityCounts {
  INFO: number;
  WARN: number;
  ERROR: number;
}

export interface SessionSeverityDelta {
  INFO: number;
  WARN: number;
  ERROR: number;
}

export interface SessionMetadataDiffField<T> {
  base: T;
  target: T;
  changed: boolean;
}

export interface SessionMetadataDiff {
  commandId: SessionMetadataDiffField<RunSession["commandId"]>;
  taskName: SessionMetadataDiffField<string | null>;
  badge: SessionMetadataDiffField<RunSession["badge"]>;
  reasonCode: SessionMetadataDiffField<RunSession["reasonCode"]>;
  startedAt: SessionMetadataDiffField<string>;
  durationMs: SessionMetadataDiffField<number>;
}

export interface IntroducedError {
  fingerprint: string;
  label: string;
  message: string;
  reasonCode: string;
}

export interface SessionComparison {
  baseSessionId: string;
  targetSessionId: string;
  metadata: SessionMetadataDiff;
  eventCount: {
    base: number;
    target: number;
    delta: number;
  };
  severityCount: {
    base: SessionSeverityCounts;
    target: SessionSeverityCounts;
    delta: SessionSeverityDelta;
  };
  newErrorsIntroduced: IntroducedError[];
}

function levelToSeverity(level: RunSessionEvent["level"]): FingerprintSeverity {
  if (level === "error") {
    return "ERROR";
  }
  if (level === "warn") {
    return "WARN";
  }
  return "INFO";
}

function buildSeverityCounts(events: RunSessionEvent[]): SessionSeverityCounts {
  const counts: SessionSeverityCounts = {
    INFO: 0,
    WARN: 0,
    ERROR: 0,
  };

  for (const event of events) {
    counts[levelToSeverity(event.level)] += 1;
  }
  return counts;
}

function buildSeverityDelta(base: SessionSeverityCounts, target: SessionSeverityCounts): SessionSeverityDelta {
  return {
    INFO: target.INFO - base.INFO,
    WARN: target.WARN - base.WARN,
    ERROR: target.ERROR - base.ERROR,
  };
}

interface ErrorFingerprintEntry {
  fingerprint: string;
  message: string;
  label: string;
  reasonCode: string;
}

function buildErrorFingerprintEntries(session: RunSession): ErrorFingerprintEntry[] {
  const entries = session.events
    .filter((event) => levelToSeverity(event.level) === "ERROR")
    .map((event) => {
      const message = redactOutput(event.msg);
      return {
        fingerprint: buildEventFingerprint({
          severity: "ERROR",
          label: session.label,
          message,
          reasonCode: session.reasonCode,
        }),
        message,
        label: redactOutput(session.label),
        reasonCode: session.reasonCode,
      };
    });

  const deduped = new Map<string, ErrorFingerprintEntry>();
  for (const entry of entries) {
    if (!deduped.has(entry.fingerprint)) {
      deduped.set(entry.fingerprint, entry);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

export function compareRunSessions(base: RunSession, target: RunSession): SessionComparison {
  const baseSeverity = buildSeverityCounts(base.events);
  const targetSeverity = buildSeverityCounts(target.events);
  const baseErrors = new Set(buildErrorFingerprintEntries(base).map((entry) => entry.fingerprint));
  const introduced = buildErrorFingerprintEntries(target)
    .filter((entry) => !baseErrors.has(entry.fingerprint))
    .map((entry) => ({
      fingerprint: entry.fingerprint,
      label: entry.label,
      message: entry.message,
      reasonCode: entry.reasonCode,
    }));

  return {
    baseSessionId: base.id,
    targetSessionId: target.id,
    metadata: {
      commandId: {
        base: base.commandId,
        target: target.commandId,
        changed: base.commandId !== target.commandId,
      },
      taskName: {
        base: base.taskName,
        target: target.taskName,
        changed: (base.taskName ?? "") !== (target.taskName ?? ""),
      },
      badge: {
        base: base.badge,
        target: target.badge,
        changed: base.badge !== target.badge,
      },
      reasonCode: {
        base: base.reasonCode,
        target: target.reasonCode,
        changed: base.reasonCode !== target.reasonCode,
      },
      startedAt: {
        base: base.startedAt,
        target: target.startedAt,
        changed: base.startedAt !== target.startedAt,
      },
      durationMs: {
        base: base.durationMs,
        target: target.durationMs,
        changed: base.durationMs !== target.durationMs,
      },
    },
    eventCount: {
      base: base.events.length,
      target: target.events.length,
      delta: target.events.length - base.events.length,
    },
    severityCount: {
      base: baseSeverity,
      target: targetSeverity,
      delta: buildSeverityDelta(baseSeverity, targetSeverity),
    },
    newErrorsIntroduced: introduced,
  };
}
