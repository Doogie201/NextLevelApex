import { buildSessionReportBundle, SESSION_REPORT_SCHEMA_VERSION } from "./sessionReport";
import type { RunPreset, RunPresetConfig } from "./presetsStore";
import type { RunSession } from "./runSessions";

export const BUNDLE_SCHEMA_VERSION = "v1";

export type BundlePresetSelection = "none" | "preset" | "current";
export type InvestigationBundleKind = "presets" | "sessions" | "combined";

export interface InvestigationBundleInput {
  guiVersionTag: string;
  repo?: string;
  presetSelection: BundlePresetSelection;
  selectedPreset: RunPreset | null;
  currentConfig: RunPresetConfig | null;
  viewUrls: string[];
  sessions: RunSession[];
}

export interface BundleCreatedFrom {
  guiVersionTag: string;
  repo?: string;
}

export type BundlePreset =
  | {
      mode: "preset";
      id: string;
      name: string;
      config: RunPresetConfig;
    }
  | {
      mode: "ad-hoc";
      config: RunPresetConfig;
    }
  | null;

export interface SessionReportLike {
  schemaVersion: number;
  reportType: "session";
  guiVersion: string;
  session: {
    id: string;
    commandId: string;
    taskName: string | null;
    badge: string;
    reasonCode: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    durationLabel: string;
    degraded: boolean;
    redacted: true;
    note: string;
    events: Array<{
      id: string;
      ts: string;
      offsetMs: number;
      level: "debug" | "info" | "warn" | "error";
      fingerprint: string;
      msg: string;
    }>;
    taskResults: Array<{
      taskName: string;
      status: "PASS" | "WARN" | "FAIL" | "SKIP" | "UNKNOWN";
      reason: string;
    }>;
  };
}

export interface InvestigationBundle {
  bundleSchemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  bundleKind: InvestigationBundleKind;
  bundleId: string;
  createdFrom: BundleCreatedFrom;
  preset: BundlePreset;
  views: string[];
  sessions: SessionReportLike[];
  redacted: true;
}

interface BundleSeed {
  bundleSchemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  bundleKind: InvestigationBundleKind;
  createdFrom: BundleCreatedFrom;
  preset: BundlePreset;
  views: string[];
  sessions: SessionReportLike[];
  redacted: true;
}

function sortTaskNames(taskNames: string[]): string[] {
  return [...new Set(taskNames.map((item) => item.trim()).filter((item) => item.length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function normalizeConfig(config: RunPresetConfig): RunPresetConfig {
  return {
    commandId: config.commandId,
    taskNames: config.commandId === "dryRunTask" ? sortTaskNames(config.taskNames) : [],
    dryRun: true,
    toggles: {
      readOnly: Boolean(config.toggles.readOnly),
    },
  };
}

function normalizePreset(selection: BundlePresetSelection, preset: RunPreset | null, current: RunPresetConfig | null): BundlePreset {
  if (selection === "preset" && preset) {
    return {
      mode: "preset",
      id: preset.id.trim(),
      name: preset.name.trim(),
      config: normalizeConfig(preset.config),
    };
  }
  if (selection === "current" && current) {
    return {
      mode: "ad-hoc",
      config: normalizeConfig(current),
    };
  }
  return null;
}

function sanitizeViewUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    const next = new URL(parsed.origin + parsed.pathname);
    const allowedParams = ["view", "event", "session", "compare", "severity", "panel", "group", "layout"];
    for (const key of allowedParams) {
      const value = parsed.searchParams.get(key);
      if (value && value.trim().length > 0) {
        next.searchParams.set(key, value.trim());
      }
    }
    return next.toString();
  } catch {
    return null;
  }
}

function normalizeViews(viewUrls: string[]): string[] {
  return [...new Set(viewUrls.map((item) => sanitizeViewUrl(item)).filter((item): item is string => Boolean(item)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function parseSessionReport(session: RunSession, guiVersionTag: string): SessionReportLike {
  const payload = JSON.parse(buildSessionReportBundle(session, guiVersionTag).json) as unknown;
  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as { reportType?: unknown }).reportType !== "session" ||
    (payload as { schemaVersion?: unknown }).schemaVersion !== SESSION_REPORT_SCHEMA_VERSION ||
    !("session" in payload)
  ) {
    throw new Error(`Session report payload invalid for session ${session.id}`);
  }
  return payload as SessionReportLike;
}

function sortSessions(sessions: RunSession[]): RunSession[] {
  return [...sessions].sort((left, right) => {
    const idCmp = left.id.localeCompare(right.id);
    if (idCmp !== 0) {
      return idCmp;
    }
    const startedCmp = left.startedAt.localeCompare(right.startedAt);
    if (startedCmp !== 0) {
      return startedCmp;
    }
    return left.commandId.localeCompare(right.commandId);
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function hashStableString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function inferInvestigationBundleKind(preset: BundlePreset, views: string[], sessions: SessionReportLike[]): InvestigationBundleKind {
  const hasPreset = preset !== null;
  const hasSessions = sessions.length > 0;
  const hasViews = views.length > 0;

  if (hasPreset && !hasSessions && !hasViews) {
    return "presets";
  }

  if (!hasPreset && hasSessions && !hasViews) {
    return "sessions";
  }

  return "combined";
}

function toBundleSeed(bundle: Omit<InvestigationBundle, "bundleId">): BundleSeed {
  return {
    bundleSchemaVersion: bundle.bundleSchemaVersion,
    bundleKind: bundle.bundleKind,
    createdFrom: bundle.createdFrom,
    preset: bundle.preset,
    views: bundle.views,
    sessions: bundle.sessions,
    redacted: bundle.redacted,
  };
}

export function buildBundleId(bundle: Omit<InvestigationBundle, "bundleId">): string {
  return `bundle-${hashStableString(stableStringify(toBundleSeed(bundle)))}`;
}

export function buildInvestigationBundle(input: InvestigationBundleInput): InvestigationBundle {
  const createdFrom: BundleCreatedFrom = {
    guiVersionTag: input.guiVersionTag,
  };
  if (input.repo && input.repo.trim().length > 0) {
    createdFrom.repo = input.repo.trim();
  }

  const preset = normalizePreset(input.presetSelection, input.selectedPreset, input.currentConfig);
  const views = normalizeViews(input.viewUrls);
  const sessions = sortSessions(input.sessions).map((session) => parseSessionReport(session, input.guiVersionTag));
  const bundleKind = inferInvestigationBundleKind(preset, views, sessions);

  const seed: Omit<InvestigationBundle, "bundleId"> = {
    bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
    bundleKind,
    createdFrom,
    preset,
    views,
    sessions,
    redacted: true,
  };

  return {
    ...seed,
    bundleId: buildBundleId(seed),
  };
}

export function buildInvestigationBundleJson(input: InvestigationBundleInput): string {
  return JSON.stringify(buildInvestigationBundle(input), null, 2);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isPresetConfig(value: unknown): value is RunPresetConfig {
  if (!isObjectRecord(value)) {
    return false;
  }

  const toggles = value.toggles;
  const taskNames = value.taskNames;
  return (
    (value.commandId === "diagnose" || value.commandId === "dryRunAll" || value.commandId === "dryRunTask") &&
    Array.isArray(taskNames) &&
    taskNames.every((item) => typeof item === "string") &&
    value.dryRun === true &&
    isObjectRecord(toggles) &&
    typeof toggles.readOnly === "boolean"
  );
}

function isBundlePreset(value: unknown): value is BundlePreset {
  if (value === null) {
    return true;
  }

  if (!isObjectRecord(value) || typeof value.mode !== "string") {
    return false;
  }

  if (value.mode === "preset") {
    return typeof value.id === "string" && typeof value.name === "string" && isPresetConfig(value.config);
  }

  if (value.mode === "ad-hoc") {
    return isPresetConfig(value.config);
  }

  return false;
}

function isSessionReportLike(value: unknown): value is SessionReportLike {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.reportType !== "session" || typeof value.schemaVersion !== "number" || typeof value.guiVersion !== "string") {
    return false;
  }

  const session = value.session;
  if (!isObjectRecord(session)) {
    return false;
  }

  if (
    typeof session.id !== "string" ||
    typeof session.commandId !== "string" ||
    !(typeof session.taskName === "string" || session.taskName === null) ||
    typeof session.badge !== "string" ||
    typeof session.reasonCode !== "string" ||
    typeof session.startedAt !== "string" ||
    typeof session.finishedAt !== "string" ||
    typeof session.durationMs !== "number" ||
    typeof session.durationLabel !== "string" ||
    typeof session.degraded !== "boolean" ||
    session.redacted !== true ||
    typeof session.note !== "string"
  ) {
    return false;
  }

  if (!Array.isArray(session.events) || !Array.isArray(session.taskResults)) {
    return false;
  }

  return (
    session.events.every(
      (entry) =>
        isObjectRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.ts === "string" &&
        typeof entry.offsetMs === "number" &&
        (entry.level === "debug" || entry.level === "info" || entry.level === "warn" || entry.level === "error") &&
        typeof entry.fingerprint === "string" &&
        typeof entry.msg === "string",
    ) &&
    session.taskResults.every(
      (entry) =>
        isObjectRecord(entry) &&
        typeof entry.taskName === "string" &&
        typeof entry.reason === "string" &&
        (entry.status === "PASS" ||
          entry.status === "WARN" ||
          entry.status === "FAIL" ||
          entry.status === "SKIP" ||
          entry.status === "UNKNOWN"),
    )
  );
}

export function parseInvestigationBundleJson(raw: string): InvestigationBundle | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed)) {
      return null;
    }

    const bundle: InvestigationBundle = {
      bundleSchemaVersion: parsed.bundleSchemaVersion as typeof BUNDLE_SCHEMA_VERSION,
      bundleKind: parsed.bundleKind as InvestigationBundleKind,
      bundleId: parsed.bundleId as string,
      createdFrom: parsed.createdFrom as BundleCreatedFrom,
      preset: parsed.preset as BundlePreset,
      views: parsed.views as string[],
      sessions: parsed.sessions as SessionReportLike[],
      redacted: parsed.redacted as true,
    };

    if (bundle.bundleSchemaVersion !== BUNDLE_SCHEMA_VERSION) {
      return null;
    }

    if (bundle.bundleKind !== "presets" && bundle.bundleKind !== "sessions" && bundle.bundleKind !== "combined") {
      return null;
    }

    if (typeof bundle.bundleId !== "string" || bundle.bundleId.trim().length === 0) {
      return null;
    }

    if (!isObjectRecord(bundle.createdFrom) || typeof bundle.createdFrom.guiVersionTag !== "string") {
      return null;
    }

    if (bundle.createdFrom.repo !== undefined && typeof bundle.createdFrom.repo !== "string") {
      return null;
    }

    if (!isBundlePreset(bundle.preset)) {
      return null;
    }

    if (!Array.isArray(bundle.views) || !bundle.views.every((item) => typeof item === "string")) {
      return null;
    }

    if (!Array.isArray(bundle.sessions) || !bundle.sessions.every((item) => isSessionReportLike(item))) {
      return null;
    }

    if (bundle.redacted !== true) {
      return null;
    }

    const expectedKind = inferInvestigationBundleKind(bundle.preset, bundle.views, bundle.sessions);
    if (bundle.bundleKind !== expectedKind) {
      return null;
    }

    const seed: Omit<InvestigationBundle, "bundleId"> = {
      bundleSchemaVersion: bundle.bundleSchemaVersion,
      bundleKind: bundle.bundleKind,
      createdFrom: bundle.createdFrom,
      preset: bundle.preset,
      views: bundle.views,
      sessions: bundle.sessions,
      redacted: bundle.redacted,
    };

    if (bundle.bundleId !== buildBundleId(seed)) {
      return null;
    }

    return bundle;
  } catch {
    return null;
  }
}
