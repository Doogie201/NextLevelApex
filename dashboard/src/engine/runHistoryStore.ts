import { buildBundleId, buildInvestigationBundle, type InvestigationBundle } from "./bundleExport";
import { validateInvestigationBundleInput } from "./bundleImport";
import type { RunPresetCommandId, RunPresetConfig } from "./presetsStore";
import { redactOutput } from "./redaction";
import type { RunSession } from "./runSessions";
import type { CommandReasonCode, HealthBadge } from "./viewModel";

export const RUN_HISTORY_STORAGE_KEY = "nlx.gui.runHistory.v1";
export const RUN_HISTORY_SCHEMA_VERSION = 1;
export const MAX_RUN_HISTORY_ENTRIES = 40;

const REPLAY_COMMAND_IDS = new Set<RunPresetCommandId>(["diagnose", "dryRunAll", "dryRunTask"]);

export type RunHistorySource = "session" | "import" | "export";
export type RunHistoryStatusFilter = "all" | "success" | "error";
export type RunHistorySortOrder = "newest" | "oldest";

export interface RunHistoryFilter {
  query: string;
  status: RunHistoryStatusFilter;
  order: RunHistorySortOrder;
}

export interface RunHistoryEntry {
  id: string;
  source: RunHistorySource;
  bundleId: string;
  bundleKind: InvestigationBundle["bundleKind"];
  bundleLabel: string;
  commandId: RunPresetCommandId | null;
  badge: HealthBadge | null;
  reasonCode: CommandReasonCode | null;
  sessionId: string | null;
  startedAt: string | null;
  bundleJson: string;
  pinned: boolean;
}

interface RunHistoryEnvelope {
  schemaVersion: number;
  entries: RunHistoryEntry[];
}

export interface RunHistoryStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface HistorySessionSummary {
  commandId: RunPresetCommandId | null;
  badge: HealthBadge | null;
  reasonCode: CommandReasonCode | null;
  sessionId: string | null;
  startedAt: string | null;
}

interface BuildEntryOptions {
  bundleLabel?: string;
  pinned?: boolean;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeTaskNames(taskNames: string[]): string[] {
  return Array.from(new Set(taskNames.map((task) => task.trim()).filter((task) => task.length > 0))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function toReplayCommandId(raw: string): RunPresetCommandId | null {
  return REPLAY_COMMAND_IDS.has(raw as RunPresetCommandId) ? (raw as RunPresetCommandId) : null;
}

function normalizeBundleLabel(raw: string): string {
  const safe = redactOutput(raw.trim().replace(/\s+/g, " "));
  if (!safe) {
    return "Run bundle";
  }
  return safe.slice(0, 96);
}

function sortSessionsForSummary(bundle: InvestigationBundle): InvestigationBundle["sessions"] {
  return [...bundle.sessions].sort((left, right) => {
    const byStartedAt = left.session.startedAt.localeCompare(right.session.startedAt);
    if (byStartedAt !== 0) {
      return byStartedAt;
    }
    const byId = left.session.id.localeCompare(right.session.id);
    if (byId !== 0) {
      return byId;
    }
    return left.session.commandId.localeCompare(right.session.commandId);
  });
}

function toSessionSummary(bundle: InvestigationBundle): HistorySessionSummary {
  const primary = sortSessionsForSummary(bundle)[0]?.session;
  if (!primary) {
    return {
      commandId: null,
      badge: null,
      reasonCode: null,
      sessionId: null,
      startedAt: null,
    };
  }

  const commandId = toReplayCommandId(primary.commandId);
  const badge = primary.badge === "OK" || primary.badge === "DEGRADED" || primary.badge === "BROKEN" ? primary.badge : null;
  const reasonCode = typeof primary.reasonCode === "string" ? (primary.reasonCode as CommandReasonCode) : null;

  return {
    commandId,
    badge,
    reasonCode,
    sessionId: primary.id,
    startedAt: primary.startedAt,
  };
}

function createHistoryId(source: RunHistorySource, bundleId: string, sessionId: string | null): string {
  return `${source}:${bundleId}:${sessionId ?? "none"}`;
}

function normalizeBundleId(bundle: InvestigationBundle): string {
  const expected = buildBundleId({
    bundleSchemaVersion: bundle.bundleSchemaVersion,
    bundleKind: bundle.bundleKind,
    createdFrom: bundle.createdFrom,
    preset: bundle.preset,
    views: bundle.views,
    sessions: bundle.sessions,
    redacted: bundle.redacted,
  });
  return expected;
}

function deriveBundleLabel(bundle: InvestigationBundle, source: RunHistorySource, explicitLabel?: string): string {
  if (explicitLabel && explicitLabel.trim().length > 0) {
    return normalizeBundleLabel(explicitLabel);
  }
  if (bundle.preset?.mode === "preset") {
    return normalizeBundleLabel(bundle.preset.name);
  }
  const first = sortSessionsForSummary(bundle)[0]?.session;
  if (first?.taskName) {
    return normalizeBundleLabel(`${first.commandId}: ${first.taskName}`);
  }
  if (first) {
    return normalizeBundleLabel(first.commandId);
  }
  return normalizeBundleLabel(`${source.toUpperCase()} bundle ${bundle.bundleId}`);
}

function isRunHistoryEntry(value: unknown): value is RunHistoryEntry {
  if (!isObjectRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    (value.source === "session" || value.source === "import" || value.source === "export") &&
    typeof value.bundleId === "string" &&
    (value.bundleKind === "presets" || value.bundleKind === "sessions" || value.bundleKind === "combined") &&
    typeof value.bundleLabel === "string" &&
    (typeof value.commandId === "string" || value.commandId === null) &&
    (typeof value.badge === "string" || value.badge === null) &&
    (typeof value.reasonCode === "string" || value.reasonCode === null) &&
    (typeof value.sessionId === "string" || value.sessionId === null) &&
    (typeof value.startedAt === "string" || value.startedAt === null) &&
    typeof value.bundleJson === "string" &&
    typeof value.pinned === "boolean"
  );
}

function isEntryShareSafe(entry: RunHistoryEntry): boolean {
  const validation = validateInvestigationBundleInput(entry.bundleJson);
  return validation.ok;
}

function compareEntries(left: RunHistoryEntry, right: RunHistoryEntry, order: RunHistorySortOrder): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }

  const leftMs = left.startedAt ? Date.parse(left.startedAt) : Number.NaN;
  const rightMs = right.startedAt ? Date.parse(right.startedAt) : Number.NaN;
  const normalizedLeft = Number.isNaN(leftMs) ? 0 : leftMs;
  const normalizedRight = Number.isNaN(rightMs) ? 0 : rightMs;
  if (normalizedLeft !== normalizedRight) {
    return order === "oldest" ? normalizedLeft - normalizedRight : normalizedRight - normalizedLeft;
  }

  const byBundle = left.bundleId.localeCompare(right.bundleId);
  if (byBundle !== 0) {
    return byBundle;
  }
  return left.id.localeCompare(right.id);
}

function sortEntries(entries: RunHistoryEntry[], order: RunHistorySortOrder = "newest"): RunHistoryEntry[] {
  return [...entries].sort((left, right) => {
    return compareEntries(left, right, order);
  });
}

function normalizeEntries(entries: RunHistoryEntry[]): RunHistoryEntry[] {
  const deduped = new Map<string, RunHistoryEntry>();
  for (const entry of entries) {
    if (!isRunHistoryEntry(entry)) {
      continue;
    }
    if (!isEntryShareSafe(entry)) {
      continue;
    }
    deduped.set(entry.id, {
      ...entry,
      bundleLabel: normalizeBundleLabel(entry.bundleLabel),
      bundleId: normalizeBundleLabel(entry.bundleId),
    });
  }
  return sortEntries(Array.from(deduped.values())).slice(0, MAX_RUN_HISTORY_ENTRIES);
}

function summarizeBundleForSearch(bundle: InvestigationBundle): string[] {
  const segments: string[] = [];

  if (bundle.preset?.mode === "preset") {
    segments.push(bundle.preset.name, bundle.preset.id, bundle.preset.config.commandId, ...bundle.preset.config.taskNames);
  } else if (bundle.preset?.mode === "ad-hoc") {
    segments.push(bundle.preset.config.commandId, ...bundle.preset.config.taskNames);
  }

  for (const report of sortSessionsForSummary(bundle)) {
    const session = report.session;
    segments.push(session.commandId, session.reasonCode, session.note);
    if (session.taskName) {
      segments.push(session.taskName);
    }

    for (const taskResult of session.taskResults) {
      segments.push(taskResult.taskName, taskResult.reason);
    }

    for (const event of session.events) {
      segments.push(event.msg);
    }
  }

  return segments;
}

function buildSearchCorpus(entry: RunHistoryEntry): string {
  const segments: string[] = [
    entry.bundleLabel,
    entry.bundleId,
    entry.commandId ?? "",
    entry.reasonCode ?? "",
    entry.sessionId ?? "",
  ];

  const bundle = parseHistoryBundle(entry);
  if (bundle) {
    segments.push(...summarizeBundleForSearch(bundle));
  }

  return segments
    .map((value) => redactOutput(value).toLowerCase())
    .filter((value) => value.length > 0)
    .join("\n");
}

function normalizeFilter(filter?: Partial<RunHistoryFilter>): RunHistoryFilter {
  return {
    query: typeof filter?.query === "string" ? filter.query.trim().toLowerCase() : "",
    status:
      filter?.status === "success" || filter?.status === "error" || filter?.status === "all" ? filter.status : "all",
    order: filter?.order === "oldest" || filter?.order === "newest" ? filter.order : "newest",
  };
}

export function filterRunHistoryEntries(entries: RunHistoryEntry[], filter?: Partial<RunHistoryFilter>): RunHistoryEntry[] {
  const normalizedFilter = normalizeFilter(filter);
  const sorted = sortEntries(entries, normalizedFilter.order);

  return sorted.filter((entry) => {
    if (normalizedFilter.status === "success" && entry.badge !== "OK") {
      return false;
    }
    if (normalizedFilter.status === "error" && entry.badge === "OK") {
      return false;
    }
    if (!normalizedFilter.query) {
      return true;
    }
    return buildSearchCorpus(entry).includes(normalizedFilter.query);
  });
}

export function createRunHistoryEntryFromBundle(
  bundle: InvestigationBundle,
  source: RunHistorySource,
  options: BuildEntryOptions = {},
): RunHistoryEntry {
  const bundleId = normalizeBundleId(bundle);
  const normalizedBundle: InvestigationBundle = bundle.bundleId === bundleId ? bundle : { ...bundle, bundleId };
  const sessionSummary = toSessionSummary(normalizedBundle);
  const id = createHistoryId(source, normalizedBundle.bundleId, sessionSummary.sessionId);
  return {
    id,
    source,
    bundleId: normalizedBundle.bundleId,
    bundleKind: normalizedBundle.bundleKind,
    bundleLabel: deriveBundleLabel(normalizedBundle, source, options.bundleLabel),
    commandId: sessionSummary.commandId,
    badge: sessionSummary.badge,
    reasonCode: sessionSummary.reasonCode,
    sessionId: sessionSummary.sessionId,
    startedAt: sessionSummary.startedAt,
    bundleJson: JSON.stringify(normalizedBundle, null, 2),
    pinned: Boolean(options.pinned),
  };
}

export function createRunHistoryEntryFromSession(
  session: RunSession,
  guiVersionTag: string,
  repo?: string,
): RunHistoryEntry {
  const bundle = buildInvestigationBundle({
    guiVersionTag,
    repo,
    presetSelection: "none",
    selectedPreset: null,
    currentConfig: null,
    viewUrls: [],
    sessions: [session],
  });
  return createRunHistoryEntryFromBundle(bundle, "session", { bundleLabel: session.label, pinned: session.pinned });
}

export function parseHistoryBundle(entry: RunHistoryEntry): InvestigationBundle | null {
  const validation = validateInvestigationBundleInput(entry.bundleJson);
  if (!validation.ok) {
    return null;
  }
  return validation.bundle;
}

export function buildReplayConfigFromBundle(bundle: InvestigationBundle): RunPresetConfig | null {
  if (bundle.preset?.mode === "preset" || bundle.preset?.mode === "ad-hoc") {
    return {
      commandId: bundle.preset.config.commandId,
      taskNames:
        bundle.preset.config.commandId === "dryRunTask" ? normalizeTaskNames(bundle.preset.config.taskNames) : [],
      dryRun: true,
      toggles: {
        readOnly: true,
      },
    };
  }

  const session = sortSessionsForSummary(bundle)[0]?.session;
  if (!session) {
    return null;
  }
  const commandId = toReplayCommandId(session.commandId);
  if (!commandId) {
    return null;
  }

  return {
    commandId,
    taskNames: commandId === "dryRunTask" && session.taskName ? normalizeTaskNames([session.taskName]) : [],
    dryRun: true,
    toggles: {
      readOnly: true,
    },
  };
}

export function addOrUpdateRunHistoryEntry(existing: RunHistoryEntry[], incoming: RunHistoryEntry): RunHistoryEntry[] {
  return normalizeEntries([incoming, ...existing.filter((entry) => entry.id !== incoming.id)]);
}

export function toggleRunHistoryPinned(existing: RunHistoryEntry[], entryId: string): RunHistoryEntry[] {
  return normalizeEntries(
    existing.map((entry) => (entry.id === entryId ? { ...entry, pinned: !entry.pinned } : entry)),
  );
}

export function clearRunHistory(): RunHistoryEntry[] {
  return [];
}

export function loadRunHistory(storage: RunHistoryStorageLike): RunHistoryEntry[] {
  const raw = storage.getItem(RUN_HISTORY_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed) || parsed.schemaVersion !== RUN_HISTORY_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }
    return normalizeEntries(parsed.entries.filter((entry) => isRunHistoryEntry(entry)));
  } catch {
    return [];
  }
}

export function storeRunHistory(storage: RunHistoryStorageLike, entries: RunHistoryEntry[]): void {
  const envelope: RunHistoryEnvelope = {
    schemaVersion: RUN_HISTORY_SCHEMA_VERSION,
    entries: normalizeEntries(entries),
  };
  storage.setItem(RUN_HISTORY_STORAGE_KEY, JSON.stringify(envelope));
}
