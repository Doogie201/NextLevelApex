import { buildSessionReportBundle } from "./sessionReport";
import type { RunPreset, RunPresetConfig } from "./presetsStore";
import type { RunSession } from "./runSessions";

export const BUNDLE_SCHEMA_VERSION = "v1";

export type BundlePresetSelection = "none" | "preset" | "current";

export interface InvestigationBundleInput {
  guiVersionTag: string;
  repo?: string;
  presetSelection: BundlePresetSelection;
  selectedPreset: RunPreset | null;
  currentConfig: RunPresetConfig | null;
  viewUrls: string[];
  sessions: RunSession[];
}

interface BundleCreatedFrom {
  guiVersionTag: string;
  repo?: string;
}

type BundlePreset =
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

interface SessionReportLike {
  schemaVersion: number;
  reportType: "session";
  guiVersion: string;
  session: {
    id: string;
    commandId: string;
    startedAt: string;
  };
}

export interface InvestigationBundle {
  bundleSchemaVersion: typeof BUNDLE_SCHEMA_VERSION;
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
      id: preset.id,
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

export function buildInvestigationBundle(input: InvestigationBundleInput): InvestigationBundle {
  const createdFrom: BundleCreatedFrom = {
    guiVersionTag: input.guiVersionTag,
  };
  if (input.repo && input.repo.trim().length > 0) {
    createdFrom.repo = input.repo.trim();
  }

  return {
    bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
    createdFrom,
    preset: normalizePreset(input.presetSelection, input.selectedPreset, input.currentConfig),
    views: normalizeViews(input.viewUrls),
    sessions: sortSessions(input.sessions).map((session) => parseSessionReport(session, input.guiVersionTag)),
    redacted: true,
  };
}

export function buildInvestigationBundleJson(input: InvestigationBundleInput): string {
  return JSON.stringify(buildInvestigationBundle(input), null, 2);
}

export function parseInvestigationBundleJson(raw: string): InvestigationBundle | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const bundle = parsed as InvestigationBundle;
    if (bundle.bundleSchemaVersion !== BUNDLE_SCHEMA_VERSION || bundle.redacted !== true) {
      return null;
    }
    if (!bundle.createdFrom || typeof bundle.createdFrom !== "object" || typeof bundle.createdFrom.guiVersionTag !== "string") {
      return null;
    }
    if (!Array.isArray(bundle.views) || !bundle.views.every((item) => typeof item === "string")) {
      return null;
    }
    if (
      !Array.isArray(bundle.sessions) ||
      !bundle.sessions.every(
        (item) =>
          item &&
          typeof item === "object" &&
          item.reportType === "session" &&
          typeof item.schemaVersion === "number" &&
          item.session &&
          typeof item.session.id === "string" &&
          typeof item.session.commandId === "string" &&
          typeof item.session.startedAt === "string",
      )
    ) {
      return null;
    }
    if (bundle.preset !== null) {
      if (bundle.preset.mode === "preset") {
        if (
          typeof bundle.preset.id !== "string" ||
          typeof bundle.preset.name !== "string" ||
          !bundle.preset.config ||
          typeof bundle.preset.config.commandId !== "string"
        ) {
          return null;
        }
      } else if (bundle.preset.mode === "ad-hoc") {
        if (!bundle.preset.config || typeof bundle.preset.config.commandId !== "string") {
          return null;
        }
      } else {
        return null;
      }
    }
    return bundle;
  } catch {
    return null;
  }
}
