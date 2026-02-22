import type { SessionReportLike } from "./bundleExport";
import { redactOutput } from "./redaction";
import { parseHistoryBundle, type RunHistoryEntry } from "./runHistoryStore";

export const RUN_DETAILS_PREVIEW_LIMIT = 1200;
export const RUN_DETAILS_ERROR_PREVIEW_LIMIT = 900;
export const RUN_SHARE_SAFE_EXPORT_SCHEMA_VERSION = "v1";

export type RunDetailsStatus = "success" | "error";
export type RunDetailsSection = "input" | "output" | "error";

export interface TruncationResult {
  text: string;
  truncated: boolean;
}

export interface RunDetailsModel {
  runId: string;
  bundleId: string;
  bundleLabel: string;
  commandId: string;
  reasonCode: string;
  timestamp: string;
  status: RunDetailsStatus;
  inputText: string;
  outputText: string;
  errorText: string;
}

export interface ShareSafeRunExport {
  schemaVersion: typeof RUN_SHARE_SAFE_EXPORT_SCHEMA_VERSION;
  runId: string;
  bundleId: string;
  bundleKind: RunHistoryEntry["bundleKind"];
  source: RunHistoryEntry["source"];
  commandId: string;
  status: RunDetailsStatus;
  reasonCode: string;
  timestamp: string;
  input: {
    text: string;
  };
  output: {
    text: string;
  };
  error: {
    text: string;
  } | null;
  redacted: true;
}

function sortSessionReports(sessions: SessionReportLike[]): SessionReportLike[] {
  return [...sessions].sort((left, right) => {
    const startedAtDiff = left.session.startedAt.localeCompare(right.session.startedAt);
    if (startedAtDiff !== 0) {
      return startedAtDiff;
    }
    const idDiff = left.session.id.localeCompare(right.session.id);
    if (idDiff !== 0) {
      return idDiff;
    }
    return left.session.commandId.localeCompare(right.session.commandId);
  });
}

function normalizeText(value: string): string {
  return redactOutput(value).replace(/\s+$/g, "");
}

function buildInputText(entry: RunHistoryEntry): string {
  const bundle = parseHistoryBundle(entry);
  if (!bundle) {
    return "";
  }

  const segments: string[] = [];
  if (bundle.preset?.mode === "preset") {
    segments.push(
      `mode=preset`,
      `presetName=${normalizeText(bundle.preset.name)}`,
      `commandId=${bundle.preset.config.commandId}`,
      `taskNames=${bundle.preset.config.taskNames.join(", ") || "(none)"}`,
      `dryRun=${String(bundle.preset.config.dryRun)}`,
      `readOnly=${String(bundle.preset.config.toggles.readOnly)}`,
    );
  } else if (bundle.preset?.mode === "ad-hoc") {
    segments.push(
      `mode=ad-hoc`,
      `commandId=${bundle.preset.config.commandId}`,
      `taskNames=${bundle.preset.config.taskNames.join(", ") || "(none)"}`,
      `dryRun=${String(bundle.preset.config.dryRun)}`,
      `readOnly=${String(bundle.preset.config.toggles.readOnly)}`,
    );
  } else {
    const session = sortSessionReports(bundle.sessions)[0]?.session;
    segments.push(`mode=derived`);
    if (session) {
      segments.push(
        `commandId=${session.commandId}`,
        `taskName=${session.taskName ? normalizeText(session.taskName) : "(none)"}`,
      );
    }
  }

  return segments.map((segment) => normalizeText(segment)).join("\n");
}

function buildOutputText(session: SessionReportLike["session"]): string {
  const eventLines = [...session.events]
    .sort((left, right) => {
      const tsDiff = left.ts.localeCompare(right.ts);
      if (tsDiff !== 0) {
        return tsDiff;
      }
      return left.id.localeCompare(right.id);
    })
    .map((event) => `[${event.ts}] [${event.level.toUpperCase()}] ${normalizeText(event.msg)}`);

  const taskLines = [...session.taskResults]
    .sort((left, right) => {
      const nameDiff = left.taskName.localeCompare(right.taskName);
      if (nameDiff !== 0) {
        return nameDiff;
      }
      return left.status.localeCompare(right.status);
    })
    .map((result) => `[${result.status}] ${normalizeText(result.taskName)}: ${normalizeText(result.reason)}`);

  return [`note: ${normalizeText(session.note)}`, ...eventLines, ...taskLines].join("\n");
}

function buildErrorText(session: SessionReportLike["session"]): string {
  const eventErrors = session.events
    .filter((event) => event.level === "error")
    .sort((left, right) => {
      const tsDiff = left.ts.localeCompare(right.ts);
      if (tsDiff !== 0) {
        return tsDiff;
      }
      return left.id.localeCompare(right.id);
    })
    .map((event) => `[${event.ts}] ${normalizeText(event.msg)}`);

  const resultErrors = session.taskResults
    .filter((result) => result.status === "FAIL")
    .sort((left, right) => left.taskName.localeCompare(right.taskName))
    .map((result) => `${normalizeText(result.taskName)}: ${normalizeText(result.reason)}`);

  const reasons = [...eventErrors, ...resultErrors];
  if (reasons.length > 0) {
    return reasons.join("\n");
  }
  if (session.badge !== "OK") {
    return normalizeText(`reasonCode=${session.reasonCode}`);
  }
  return "";
}

export function truncateRunDetails(text: string, maxLength: number): TruncationResult {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return {
      text: normalized,
      truncated: false,
    };
  }
  return {
    text: `${normalized.slice(0, maxLength).replace(/\s+$/g, "")}\n… (truncated; expand to view more)`,
    truncated: true,
  };
}

export function resolveRunHistorySelection(entries: RunHistoryEntry[], selectedRunId: string | null): string | null {
  if (entries.length === 0) {
    return null;
  }
  if (!selectedRunId) {
    return null;
  }
  if (entries.some((entry) => entry.id === selectedRunId)) {
    return selectedRunId;
  }
  return null;
}

export function buildRunDetailsModel(entry: RunHistoryEntry): RunDetailsModel | null {
  const bundle = parseHistoryBundle(entry);
  if (!bundle) {
    return null;
  }
  const primary = sortSessionReports(bundle.sessions)[0]?.session;
  if (!primary) {
    return null;
  }

  return {
    runId: entry.id,
    bundleId: entry.bundleId,
    bundleLabel: entry.bundleLabel,
    commandId: primary.commandId,
    reasonCode: primary.reasonCode,
    timestamp: primary.startedAt,
    status: primary.badge === "OK" ? "success" : "error",
    inputText: buildInputText(entry),
    outputText: buildOutputText(primary),
    errorText: buildErrorText(primary),
  };
}

function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepSort(item));
  }
  if (value && typeof value === "object") {
    const sorted = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, deepSort(entryValue)]);
    return Object.fromEntries(sorted);
  }
  if (typeof value === "string") {
    return normalizeText(value);
  }
  return value;
}

function sortPayload(value: ShareSafeRunExport): ShareSafeRunExport {
  return deepSort(value) as ShareSafeRunExport;
}

export function buildShareSafeRunExport(entry: RunHistoryEntry): ShareSafeRunExport | null {
  const model = buildRunDetailsModel(entry);
  if (!model) {
    return null;
  }

  return {
    schemaVersion: RUN_SHARE_SAFE_EXPORT_SCHEMA_VERSION,
    runId: model.runId,
    bundleId: model.bundleId,
    bundleKind: entry.bundleKind,
    source: entry.source,
    commandId: model.commandId,
    status: model.status,
    reasonCode: model.reasonCode,
    timestamp: model.timestamp,
    input: {
      text: model.inputText,
    },
    output: {
      text: model.outputText,
    },
    error: model.errorText
      ? {
          text: model.errorText,
        }
      : null,
    redacted: true,
  };
}

export function buildRunDetailsModelFromShareSafeExport(value: ShareSafeRunExport): RunDetailsModel {
  return {
    runId: value.runId,
    bundleId: value.bundleId,
    bundleLabel: `${value.commandId} (${value.runId.slice(0, 8)})`,
    commandId: value.commandId,
    reasonCode: value.reasonCode,
    timestamp: value.timestamp,
    status: value.status,
    inputText: normalizeText(value.input.text),
    outputText: normalizeText(value.output.text),
    errorText: normalizeText(value.error?.text ?? ""),
  };
}

export function buildShareSafeRunExportJsonFromPayload(value: ShareSafeRunExport): string {
  return JSON.stringify(sortPayload(value), null, 2);
}

export function buildShareSafeRunExportJson(entry: RunHistoryEntry): string | null {
  const payload = buildShareSafeRunExport(entry);
  if (!payload) {
    return null;
  }
  return buildShareSafeRunExportJsonFromPayload(payload);
}
