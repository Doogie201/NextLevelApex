import type { BundleDiffEntry, BundleDiffSummary } from "./bundleDiff";
import { buildRunHistoryShareSafeDiffFromExports } from "./runHistoryCompare";
import { redactOutput } from "./redaction";
import type { RunHistoryFilter, RunHistorySortOrder, RunHistoryStatusFilter } from "./runHistoryStore";
import type { ShareSafeRunExport } from "./runShareSafeExport";
import type { HealthBadge } from "./viewModel";

export const CASE_BUNDLE_SCHEMA_VERSION = "v1";
export const MAX_CASE_BUNDLE_IMPORT_BYTES = 1_500_000;

export const CASE_BUNDLE_SEARCH_FIELD_WHITELIST = [
  "run.runId",
  "run.bundleId",
  "run.commandId",
  "run.reasonCode",
  "run.input.text",
  "run.output.text",
  "run.error.text",
] as const;

export interface CaseBundleCompareArtifact {
  baseRunId: string;
  targetRunId: string;
  summary: BundleDiffSummary;
  entries: BundleDiffEntry[];
  truncated: boolean;
}

export interface CaseBundle {
  schemaVersion: typeof CASE_BUNDLE_SCHEMA_VERSION;
  createdAt: string;
  guiBuildId?: string;
  runs: ShareSafeRunExport[];
  compares: CaseBundleCompareArtifact[];
}

export interface CaseBundleRunListItem {
  id: string;
  run: ShareSafeRunExport;
  bundleLabel: string;
  commandId: string;
  reasonCode: string;
  bundleId: string;
  startedAt: string;
  badge: HealthBadge;
  status: RunHistoryStatusFilter;
}

export interface CaseBundleParseSuccess {
  ok: true;
  bundle: CaseBundle;
  warnings: string[];
}

export interface CaseBundleParseFailure {
  ok: false;
  error: string;
  warnings: string[];
}

export type CaseBundleParseResult = CaseBundleParseSuccess | CaseBundleParseFailure;

export interface BuildCaseBundleInput {
  createdAt: string;
  guiBuildId?: string;
  runs: ShareSafeRunExport[];
  comparePairs?: Array<{
    baseRunId: string;
    targetRunId: string;
  }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return redactOutput(value).replace(/\s+/g, " ").trim();
}

function normalizeTimestamp(iso: string): string {
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) {
    return "1970-01-01T00:00:00.000Z";
  }
  return new Date(millis).toISOString();
}

function normalizeStatus(status: string): "success" | "error" {
  return status === "success" ? "success" : "error";
}

function normalizeRun(run: ShareSafeRunExport): ShareSafeRunExport {
  return {
    schemaVersion: "v1",
    runId: run.runId.trim(),
    bundleId: run.bundleId.trim(),
    bundleKind: run.bundleKind,
    source: run.source,
    commandId: run.commandId.trim(),
    status: normalizeStatus(run.status),
    reasonCode: run.reasonCode.trim(),
    timestamp: normalizeTimestamp(run.timestamp),
    input: {
      text: redactOutput(run.input.text),
    },
    output: {
      text: redactOutput(run.output.text),
    },
    error: run.error
      ? {
          text: redactOutput(run.error.text),
        }
      : null,
    redacted: true,
  };
}

function compareRunOrder(left: ShareSafeRunExport, right: ShareSafeRunExport): number {
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  const byRunId = left.runId.localeCompare(right.runId);
  if (byRunId !== 0) {
    return byRunId;
  }
  const byCommandId = left.commandId.localeCompare(right.commandId);
  if (byCommandId !== 0) {
    return byCommandId;
  }
  return left.bundleId.localeCompare(right.bundleId);
}

function compareRunOrderByMode(
  left: ShareSafeRunExport,
  right: ShareSafeRunExport,
  order: RunHistorySortOrder,
): number {
  const cmp = compareRunOrder(left, right);
  return order === "oldest" ? -cmp : cmp;
}

function dedupeAndSortRuns(runs: ShareSafeRunExport[]): ShareSafeRunExport[] {
  const deduped = new Map<string, ShareSafeRunExport>();
  for (const run of runs) {
    const normalized = normalizeRun(run);
    deduped.set(normalized.runId, normalized);
  }
  return [...deduped.values()].sort(compareRunOrder);
}

function compareArtifactOrder(left: CaseBundleCompareArtifact, right: CaseBundleCompareArtifact): number {
  const byBase = left.baseRunId.localeCompare(right.baseRunId);
  if (byBase !== 0) {
    return byBase;
  }
  return left.targetRunId.localeCompare(right.targetRunId);
}

function normalizeCompareArtifact(value: CaseBundleCompareArtifact): CaseBundleCompareArtifact {
  const entries = [...value.entries].sort((left, right) => {
    const byPath = left.path.localeCompare(right.path);
    if (byPath !== 0) {
      return byPath;
    }
    return left.kind.localeCompare(right.kind);
  });
  return {
    baseRunId: value.baseRunId.trim(),
    targetRunId: value.targetRunId.trim(),
    summary: {
      added: Math.max(0, Math.floor(value.summary.added)),
      removed: Math.max(0, Math.floor(value.summary.removed)),
      changed: Math.max(0, Math.floor(value.summary.changed)),
      total: Math.max(0, Math.floor(value.summary.total)),
    },
    entries,
    truncated: Boolean(value.truncated),
  };
}

function normalizeCompareArtifacts(artifacts: CaseBundleCompareArtifact[]): CaseBundleCompareArtifact[] {
  return artifacts.map((artifact) => normalizeCompareArtifact(artifact)).sort(compareArtifactOrder);
}

function computeCompareArtifacts(
  runs: ShareSafeRunExport[],
  comparePairs: Array<{ baseRunId: string; targetRunId: string }> | undefined,
): CaseBundleCompareArtifact[] {
  if (!comparePairs || comparePairs.length === 0) {
    return [];
  }
  const runMap = new Map(runs.map((run) => [run.runId, run]));
  const artifacts: CaseBundleCompareArtifact[] = [];
  for (const pair of comparePairs) {
    const base = runMap.get(pair.baseRunId.trim());
    const target = runMap.get(pair.targetRunId.trim());
    if (!base || !target || base.runId === target.runId) {
      continue;
    }
    const diff = buildRunHistoryShareSafeDiffFromExports(base, target);
    artifacts.push({
      baseRunId: base.runId,
      targetRunId: target.runId,
      summary: diff.diff.summary,
      entries: diff.diff.entries,
      truncated: diff.diff.truncated,
    });
  }
  return normalizeCompareArtifacts(artifacts);
}

function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepSort(item));
  }
  if (isObject(value)) {
    const sorted = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, deepSort(entryValue)]);
    return Object.fromEntries(sorted);
  }
  if (typeof value === "string") {
    return redactOutput(value);
  }
  return value;
}

function buildSearchCorpus(run: ShareSafeRunExport): string {
  const segments = [
    run.runId,
    run.bundleId,
    run.commandId,
    run.reasonCode,
    run.input.text,
    run.output.text,
    run.error?.text ?? "",
  ];
  return segments
    .map((segment) => normalizeText(segment).toLowerCase())
    .filter((segment) => segment.length > 0)
    .join(" ");
}

function toBadge(status: "success" | "error"): HealthBadge {
  return status === "success" ? "OK" : "BROKEN";
}

function toListItem(run: ShareSafeRunExport): CaseBundleRunListItem {
  return {
    id: run.runId,
    run,
    bundleLabel: `${run.commandId} (${run.runId.slice(0, 8)})`,
    commandId: run.commandId,
    reasonCode: run.reasonCode,
    bundleId: run.bundleId,
    startedAt: run.timestamp,
    badge: toBadge(run.status),
    status: run.status,
  };
}

function isShareSafeRunExport(value: unknown): value is ShareSafeRunExport {
  if (!isObject(value)) {
    return false;
  }
  if (value.schemaVersion !== "v1") {
    return false;
  }
  if (
    typeof value.runId !== "string" ||
    typeof value.bundleId !== "string" ||
    typeof value.commandId !== "string" ||
    typeof value.reasonCode !== "string" ||
    typeof value.timestamp !== "string"
  ) {
    return false;
  }
  if (value.status !== "success" && value.status !== "error") {
    return false;
  }
  if (value.redacted !== true) {
    return false;
  }
  if (!isObject(value.input) || typeof value.input.text !== "string") {
    return false;
  }
  if (!isObject(value.output) || typeof value.output.text !== "string") {
    return false;
  }
  if (value.error !== null && (!isObject(value.error) || typeof value.error.text !== "string")) {
    return false;
  }
  return true;
}

function ensureRunRedacted(run: ShareSafeRunExport): boolean {
  const segments = [run.input.text, run.output.text, run.error?.text ?? "", run.reasonCode, run.commandId, run.bundleId];
  return segments.every((segment) => redactOutput(segment) === segment);
}

function isCompareArtifact(value: unknown): value is CaseBundleCompareArtifact {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.baseRunId !== "string" || typeof value.targetRunId !== "string") {
    return false;
  }
  if (!isObject(value.summary)) {
    return false;
  }
  if (
    typeof value.summary.added !== "number" ||
    typeof value.summary.removed !== "number" ||
    typeof value.summary.changed !== "number" ||
    typeof value.summary.total !== "number"
  ) {
    return false;
  }
  if (!Array.isArray(value.entries)) {
    return false;
  }
  if (!value.entries.every((entry) => {
    if (!isObject(entry)) {
      return false;
    }
    if (typeof entry.path !== "string") {
      return false;
    }
    if (entry.kind !== "added" && entry.kind !== "removed" && entry.kind !== "changed") {
      return false;
    }
    if (entry.left !== undefined && typeof entry.left !== "string") {
      return false;
    }
    if (entry.right !== undefined && typeof entry.right !== "string") {
      return false;
    }
    return true;
  })) {
    return false;
  }
  if (typeof value.truncated !== "boolean") {
    return false;
  }
  return true;
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

export function buildCaseBundle(input: BuildCaseBundleInput): CaseBundle {
  const normalizedRuns = dedupeAndSortRuns(input.runs);
  const normalizedCompares = computeCompareArtifacts(normalizedRuns, input.comparePairs);
  return {
    schemaVersion: CASE_BUNDLE_SCHEMA_VERSION,
    createdAt: normalizeTimestamp(input.createdAt),
    guiBuildId: input.guiBuildId?.trim() ? input.guiBuildId.trim() : undefined,
    runs: normalizedRuns,
    compares: normalizedCompares,
  };
}

export function buildCaseBundleJson(bundle: CaseBundle): string {
  return JSON.stringify(deepSort(bundle), null, 2);
}

export function parseCaseBundleJson(raw: string): CaseBundleParseResult {
  if (!raw || raw.trim().length === 0) {
    return {
      ok: false,
      error: "Case bundle payload is empty.",
      warnings: [],
    };
  }

  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > MAX_CASE_BUNDLE_IMPORT_BYTES) {
    return {
      ok: false,
      error: `Case bundle exceeds size limit (${MAX_CASE_BUNDLE_IMPORT_BYTES} bytes).`,
      warnings: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch {
    return {
      ok: false,
      error: "Case bundle JSON is malformed.",
      warnings: [],
    };
  }

  if (!isObject(parsed) || typeof parsed.schemaVersion !== "string") {
    return {
      ok: false,
      error: "Case bundle schemaVersion is missing.",
      warnings: [],
    };
  }
  if (parsed.schemaVersion !== CASE_BUNDLE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported case bundle schemaVersion: ${parsed.schemaVersion}.`,
      warnings: [],
    };
  }
  if (!Array.isArray(parsed.runs)) {
    return {
      ok: false,
      error: "Case bundle runs array is missing.",
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const validRuns: ShareSafeRunExport[] = [];
  for (const run of parsed.runs) {
    if (!isShareSafeRunExport(run)) {
      return {
        ok: false,
        error: "Case bundle contains malformed run entries.",
        warnings,
      };
    }
    if (!ensureRunRedacted(run)) {
      return {
        ok: false,
        error: "Case bundle contains non-redacted run content.",
        warnings,
      };
    }
    validRuns.push(normalizeRun(run));
  }

  const normalizedRuns = dedupeAndSortRuns(validRuns);
  const runIds = new Set(normalizedRuns.map((run) => run.runId));
  const compareArtifacts: CaseBundleCompareArtifact[] = [];
  if (Array.isArray(parsed.compares)) {
    for (const compare of parsed.compares) {
      if (!isCompareArtifact(compare)) {
        warnings.push("Dropped malformed compare artifact.");
        continue;
      }
      if (!runIds.has(compare.baseRunId) || !runIds.has(compare.targetRunId) || compare.baseRunId === compare.targetRunId) {
        warnings.push(`Dropped compare artifact with unknown run references (${compare.baseRunId} -> ${compare.targetRunId}).`);
        continue;
      }
      compareArtifacts.push(normalizeCompareArtifact(compare));
    }
  }

  const createdAtRaw = typeof parsed.createdAt === "string" ? parsed.createdAt : "1970-01-01T00:00:00.000Z";
  const bundle: CaseBundle = {
    schemaVersion: CASE_BUNDLE_SCHEMA_VERSION,
    createdAt: normalizeTimestamp(createdAtRaw),
    guiBuildId: typeof parsed.guiBuildId === "string" && parsed.guiBuildId.trim().length > 0 ? parsed.guiBuildId.trim() : undefined,
    runs: normalizedRuns,
    compares: normalizeCompareArtifacts(compareArtifacts),
  };

  return {
    ok: true,
    bundle,
    warnings,
  };
}

export function toCaseBundleRunListItems(bundle: CaseBundle): CaseBundleRunListItem[] {
  return bundle.runs.map((run) => toListItem(run));
}

export function filterCaseBundleRunListItems(
  items: CaseBundleRunListItem[],
  filter: Pick<RunHistoryFilter, "query" | "status" | "order">,
): CaseBundleRunListItem[] {
  const query = normalizeText(filter.query).toLowerCase();
  const status = filter.status;
  const order = filter.order;

  return [...items]
    .filter((item) => {
      if (status === "success" && item.status !== "success") {
        return false;
      }
      if (status === "error" && item.status !== "error") {
        return false;
      }
      if (!query) {
        return true;
      }
      return buildSearchCorpus(item.run).includes(query);
    })
    .sort((left, right) => compareRunOrderByMode(left.run, right.run, order));
}
