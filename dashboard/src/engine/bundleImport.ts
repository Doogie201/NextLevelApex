import type { RunPreset, RunPresetCommandId, RunPresetConfig } from "./presetsStore";
import { addOrUpdatePreset, buildRunPreset } from "./presetsStore";
import { redactOutput } from "./redaction";
import { MAX_SAVED_VIEWS } from "./savedViewsStore";
import { addRunSession, MAX_STORED_RUN_SESSIONS, sortRunSessions, type RunSession } from "./runSessions";
import {
  BUNDLE_SCHEMA_VERSION,
  buildBundleId,
  parseInvestigationBundleJson,
  type InvestigationBundle,
  type SessionReportLike,
} from "./bundleExport";

export const MAX_BUNDLE_IMPORT_BYTES = 512_000;

const PRESET_COMMAND_IDS = new Set<RunPresetCommandId>(["diagnose", "dryRunAll", "dryRunTask"]);

type BundleImportValidationCode =
  | "EMPTY"
  | "INVALID_SCHEMA"
  | "TOO_LARGE"
  | "SIZE_LIMIT"
  | "INTEGRITY"
  | "UNREDACTED_CONTENT";

export interface BundleImportValidationError {
  code: BundleImportValidationCode;
  path: string;
  message: string;
}

export type BundleImportValidationResult =
  | {
      ok: true;
      bundle: InvestigationBundle;
    }
  | {
      ok: false;
      errors: BundleImportValidationError[];
    };

export interface BundleImportPreview {
  bundleKind: InvestigationBundle["bundleKind"];
  presetCandidates: number;
  sessionCandidates: number;
  viewCandidates: number;
  duplicatePresets: number;
  duplicateSessions: number;
}

export interface ApplyBundleImportInput {
  bundle: InvestigationBundle;
  existingPresets: RunPreset[];
  existingSessions: RunSession[];
}

export interface ApplyBundleImportResult {
  presets: RunPreset[];
  sessions: RunSession[];
  preview: BundleImportPreview;
  addedPresets: number;
  skippedPresets: number;
  addedSessions: number;
  skippedSessions: number;
}

function isPresetConfig(value: unknown): value is RunPresetConfig {
  if (!value || typeof value !== "object") {
    return false;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.commandId !== "string" || !PRESET_COMMAND_IDS.has(raw.commandId as RunPresetCommandId)) {
    return false;
  }
  if (raw.dryRun !== true) {
    return false;
  }
  if (!Array.isArray(raw.taskNames) || !raw.taskNames.every((item) => typeof item === "string")) {
    return false;
  }
  if (!raw.toggles || typeof raw.toggles !== "object") {
    return false;
  }
  return typeof (raw.toggles as Record<string, unknown>).readOnly === "boolean";
}

function normalizeTaskNames(taskNames: string[]): string[] {
  return [...new Set(taskNames.map((item) => item.trim()).filter((item) => item.length > 0))].sort((a, b) => a.localeCompare(b));
}

function normalizePresetConfig(config: RunPresetConfig): RunPresetConfig {
  const commandId = config.commandId;
  return {
    commandId,
    taskNames: commandId === "dryRunTask" ? normalizeTaskNames(config.taskNames) : [],
    dryRun: true,
    toggles: {
      readOnly: Boolean(config.toggles.readOnly),
    },
  };
}

function toImportedPreset(bundle: InvestigationBundle): RunPreset | null {
  const preset = bundle.preset;
  if (!preset) {
    return null;
  }

  const timestampIso = bundle.sessions[0]?.session.startedAt ?? "1970-01-01T00:00:00.000Z";

  if (preset.mode === "preset") {
    if (!isPresetConfig(preset.config)) {
      return null;
    }
    return buildRunPreset({
      id: preset.id,
      name: preset.name,
      config: normalizePresetConfig(preset.config),
      timestampIso,
    });
  }

  if (preset.mode === "ad-hoc") {
    if (!isPresetConfig(preset.config)) {
      return null;
    }
    const importedId = `bundle-${bundle.bundleId.slice(0, 16)}`;
    return buildRunPreset({
      id: importedId,
      name: `Imported ${preset.config.commandId} (${bundle.bundleId.slice(0, 8)})`,
      config: normalizePresetConfig(preset.config),
      timestampIso,
    });
  }

  return null;
}

function severityFromBadge(badge: string): RunSession["severity"] {
  if (badge === "OK") {
    return "PASS";
  }
  if (badge === "DEGRADED") {
    return "WARN";
  }
  return "FAIL";
}

function statusClassFromSeverity(severity: RunSession["severity"]): RunSession["statusClass"] {
  if (severity === "PASS") {
    return "status-pass";
  }
  if (severity === "WARN") {
    return "status-warn";
  }
  return "status-fail";
}

function sortSessionReportsForImport(reports: SessionReportLike[]): SessionReportLike[] {
  return [...reports].sort((left, right) => {
    const byId = left.session.id.localeCompare(right.session.id);
    if (byId !== 0) {
      return byId;
    }
    const byStartedAt = left.session.startedAt.localeCompare(right.session.startedAt);
    if (byStartedAt !== 0) {
      return byStartedAt;
    }
    return left.session.commandId.localeCompare(right.session.commandId);
  });
}

function toImportedSession(report: SessionReportLike): RunSession {
  const severity = severityFromBadge(report.session.badge);
  const labelBase = report.session.taskName ? `${report.session.commandId}: ${report.session.taskName}` : report.session.commandId;

  return {
    id: report.session.id,
    eventId: report.session.events[0]?.id ?? `${report.session.id}-evt-0`,
    commandId: report.session.commandId as RunSession["commandId"],
    taskName: report.session.taskName ? redactOutput(report.session.taskName) : null,
    label: redactOutput(`Imported ${labelBase}`),
    badge: report.session.badge as RunSession["badge"],
    reasonCode: report.session.reasonCode as RunSession["reasonCode"],
    startedAt: report.session.startedAt,
    finishedAt: report.session.finishedAt,
    durationMs: Math.max(0, Math.floor(report.session.durationMs)),
    durationLabel: report.session.durationLabel,
    degraded: report.session.degraded || report.session.badge !== "OK",
    redacted: true,
    severity,
    statusClass: statusClassFromSeverity(severity),
    note: redactOutput(report.session.note),
    taskResults: [...report.session.taskResults]
      .map((item) => ({
        taskName: redactOutput(item.taskName),
        status: item.status,
        reason: redactOutput(item.reason),
      }))
      .sort((left, right) => {
        const byTask = left.taskName.localeCompare(right.taskName);
        if (byTask !== 0) {
          return byTask;
        }
        const byStatus = left.status.localeCompare(right.status);
        if (byStatus !== 0) {
          return byStatus;
        }
        return left.reason.localeCompare(right.reason);
      }),
    events: [...report.session.events]
      .map((event) => ({
        id: event.id,
        ts: event.ts,
        offsetMs: Math.max(0, Math.floor(event.offsetMs)),
        level: event.level,
        msg: redactOutput(event.msg),
      }))
      .sort((left, right) => {
        if (left.offsetMs !== right.offsetMs) {
          return left.offsetMs - right.offsetMs;
        }
        return left.id.localeCompare(right.id);
      }),
    pinned: false,
  };
}

function checkRedacted(value: string, path: string, errors: BundleImportValidationError[]): void {
  if (redactOutput(value) !== value) {
    errors.push({
      code: "UNREDACTED_CONTENT",
      path,
      message: "Detected unredacted-looking content. Import rejected.",
    });
  }
}

function collectValidationErrors(bundle: InvestigationBundle): BundleImportValidationError[] {
  const errors: BundleImportValidationError[] = [];

  if (bundle.bundleSchemaVersion !== BUNDLE_SCHEMA_VERSION) {
    errors.push({
      code: "INVALID_SCHEMA",
      path: "bundleSchemaVersion",
      message: `Unsupported bundle schema version. Expected ${BUNDLE_SCHEMA_VERSION}.`,
    });
  }

  if (bundle.sessions.length > MAX_STORED_RUN_SESSIONS) {
    errors.push({
      code: "SIZE_LIMIT",
      path: "sessions",
      message: `Bundle contains too many sessions (${bundle.sessions.length}). Max supported is ${MAX_STORED_RUN_SESSIONS}.`,
    });
  }

  if (bundle.views.length > MAX_SAVED_VIEWS) {
    errors.push({
      code: "SIZE_LIMIT",
      path: "views",
      message: `Bundle contains too many saved views (${bundle.views.length}). Max supported is ${MAX_SAVED_VIEWS}.`,
    });
  }

  const expectedBundleId = buildBundleId({
    bundleSchemaVersion: bundle.bundleSchemaVersion,
    bundleKind: bundle.bundleKind,
    createdFrom: bundle.createdFrom,
    preset: bundle.preset,
    views: bundle.views,
    sessions: bundle.sessions,
    redacted: bundle.redacted,
  });

  if (bundle.bundleId !== expectedBundleId) {
    errors.push({
      code: "INTEGRITY",
      path: "bundleId",
      message: "Bundle ID integrity check failed. Content may be altered or non-deterministic.",
    });
  }

  if (bundle.preset) {
    const preset = bundle.preset;
    const config = preset.mode === "preset" ? preset.config : preset.config;
    if (!isPresetConfig(config)) {
      errors.push({
        code: "INVALID_SCHEMA",
        path: "preset.config",
        message: "Preset configuration is invalid or unsupported.",
      });
    }
  }

  if (bundle.createdFrom.repo) {
    checkRedacted(bundle.createdFrom.repo, "createdFrom.repo", errors);
  }

  if (bundle.preset) {
    if (bundle.preset.mode === "preset") {
      checkRedacted(bundle.preset.name, "preset.name", errors);
      for (let index = 0; index < bundle.preset.config.taskNames.length; index += 1) {
        checkRedacted(bundle.preset.config.taskNames[index], `preset.config.taskNames[${index}]`, errors);
      }
    } else {
      for (let index = 0; index < bundle.preset.config.taskNames.length; index += 1) {
        checkRedacted(bundle.preset.config.taskNames[index], `preset.config.taskNames[${index}]`, errors);
      }
    }
  }

  for (let index = 0; index < bundle.views.length; index += 1) {
    checkRedacted(bundle.views[index], `views[${index}]`, errors);
  }

  for (let sessionIndex = 0; sessionIndex < bundle.sessions.length; sessionIndex += 1) {
    const session = bundle.sessions[sessionIndex].session;
    if (session.taskName) {
      checkRedacted(session.taskName, `sessions[${sessionIndex}].session.taskName`, errors);
    }
    checkRedacted(session.note, `sessions[${sessionIndex}].session.note`, errors);

    for (let eventIndex = 0; eventIndex < session.events.length; eventIndex += 1) {
      checkRedacted(session.events[eventIndex].msg, `sessions[${sessionIndex}].session.events[${eventIndex}].msg`, errors);
    }

    for (let resultIndex = 0; resultIndex < session.taskResults.length; resultIndex += 1) {
      checkRedacted(
        session.taskResults[resultIndex].taskName,
        `sessions[${sessionIndex}].session.taskResults[${resultIndex}].taskName`,
        errors,
      );
      checkRedacted(
        session.taskResults[resultIndex].reason,
        `sessions[${sessionIndex}].session.taskResults[${resultIndex}].reason`,
        errors,
      );
    }
  }
  return errors;
}

export function validateInvestigationBundleInput(raw: string): BundleImportValidationResult {
  if (!raw.trim()) {
    return {
      ok: false,
      errors: [
        {
          code: "EMPTY",
          path: "$",
          message: "Bundle JSON is empty.",
        },
      ],
    };
  }

  const byteLength = new TextEncoder().encode(raw).length;
  if (byteLength > MAX_BUNDLE_IMPORT_BYTES) {
    return {
      ok: false,
      errors: [
        {
          code: "TOO_LARGE",
          path: "$",
          message: `Bundle payload exceeds max size (${MAX_BUNDLE_IMPORT_BYTES} bytes).`,
        },
      ],
    };
  }

  const bundle = parseInvestigationBundleJson(raw);
  if (!bundle) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_SCHEMA",
          path: "$",
          message: "Bundle JSON does not match the expected schema.",
        },
      ],
    };
  }

  const errors = collectValidationErrors(bundle);
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }

  return {
    ok: true,
    bundle,
  };
}

export function previewInvestigationBundleImport(
  bundle: InvestigationBundle,
  existingPresets: RunPreset[],
  existingSessions: RunSession[],
): BundleImportPreview {
  const importedPreset = toImportedPreset(bundle);
  const existingPresetIds = new Set(existingPresets.map((item) => item.id));
  const existingSessionIds = new Set(existingSessions.map((item) => item.id));

  const sortedReports = sortSessionReportsForImport(bundle.sessions);
  const duplicateSessions = sortedReports.filter((entry) => existingSessionIds.has(entry.session.id)).length;

  return {
    bundleKind: bundle.bundleKind,
    presetCandidates: importedPreset ? 1 : 0,
    sessionCandidates: sortedReports.length,
    viewCandidates: bundle.views.length,
    duplicatePresets: importedPreset && existingPresetIds.has(importedPreset.id) ? 1 : 0,
    duplicateSessions,
  };
}

export function applyInvestigationBundleImport(input: ApplyBundleImportInput): ApplyBundleImportResult {
  const preview = previewInvestigationBundleImport(input.bundle, input.existingPresets, input.existingSessions);

  let presets = [...input.existingPresets];
  let sessions = sortRunSessions([...input.existingSessions]);

  let addedPresets = 0;
  let skippedPresets = 0;
  let addedSessions = 0;
  let skippedSessions = 0;

  const importedPreset = toImportedPreset(input.bundle);
  if (importedPreset) {
    const exists = presets.some((item) => item.id === importedPreset.id);
    if (exists) {
      skippedPresets += 1;
    } else {
      presets = addOrUpdatePreset(presets, importedPreset);
      addedPresets += 1;
    }
  }

  const existingSessionIds = new Set(sessions.map((item) => item.id));
  for (const report of sortSessionReportsForImport(input.bundle.sessions)) {
    if (existingSessionIds.has(report.session.id)) {
      skippedSessions += 1;
      continue;
    }
    sessions = addRunSession(sessions, toImportedSession(report));
    existingSessionIds.add(report.session.id);
    addedSessions += 1;
  }

  return {
    presets,
    sessions: sortRunSessions(sessions),
    preview,
    addedPresets,
    skippedPresets,
    addedSessions,
    skippedSessions,
  };
}
