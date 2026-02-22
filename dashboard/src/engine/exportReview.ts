import { buildCaseBundleJson, type CaseBundle } from "./caseBundle";
import { buildRunHistoryShareSafeDiffCopyText, type RunHistoryShareSafeDiff } from "./runHistoryCompare";
import { buildShareSafeRunExportJsonFromPayload, type ShareSafeRunExport } from "./runShareSafeExport";

export type ExportReviewKind = "run" | "diff" | "caseBundle";

export interface ExportReviewCount {
  label: string;
  value: number;
}

export interface ExportReviewPlanBase<TKind extends ExportReviewKind, TPayload> {
  kind: TKind;
  title: string;
  actionLabel: string;
  payload: TPayload;
  filename: string | null;
  included: string[];
  excluded: string[];
  counts: ExportReviewCount[];
  empty: boolean;
}

export type RunExportReviewPlan = ExportReviewPlanBase<"run", ShareSafeRunExport>;
export type DiffExportReviewPlan = ExportReviewPlanBase<"diff", RunHistoryShareSafeDiff>;
export type CaseBundleExportReviewPlan = ExportReviewPlanBase<"caseBundle", CaseBundle>;

export type ExportReviewPlan = RunExportReviewPlan | DiffExportReviewPlan | CaseBundleExportReviewPlan;

function countNonEmptyLines(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split("\n").filter((line) => line.trim().length > 0).length;
}

export function createRunExportReviewPlan(payload: ShareSafeRunExport, fileName?: string): RunExportReviewPlan {
  return {
    kind: "run",
    title: "Share-Safe Run Export Review",
    actionLabel: "I reviewed what will be shared",
    payload,
    filename: fileName ?? `nlx-run-share-safe-${payload.runId}.json`,
    included: [
      "normalized input summary",
      "normalized output summary",
      "normalized error summary (if present)",
      "command metadata (runId, bundleId, commandId, reasonCode, timestamp)",
    ],
    excluded: [
      "private case notes",
      "raw prompts or unredacted traces",
      "headers, tokens, environment values, and secrets",
    ],
    counts: [
      { label: "Input lines", value: countNonEmptyLines(payload.input.text) },
      { label: "Output lines", value: countNonEmptyLines(payload.output.text) },
      { label: "Error lines", value: countNonEmptyLines(payload.error?.text ?? "") },
    ],
    empty: payload.output.text.trim().length === 0 && (payload.error?.text.trim().length ?? 0) === 0,
  };
}

export function createDiffExportReviewPlan(payload: RunHistoryShareSafeDiff): DiffExportReviewPlan {
  return {
    kind: "diff",
    title: "Share-Safe Diff Copy Review",
    actionLabel: "I reviewed what will be shared",
    payload,
    filename: null,
    included: [
      "base/target run IDs and bundle IDs",
      "diff summary counts (added/removed/changed/total)",
      "share-safe before/after values per changed path",
    ],
    excluded: [
      "private case notes",
      "raw run objects and unredacted payloads",
      "non-share-safe local metadata",
    ],
    counts: [
      { label: "Added", value: payload.diff.summary.added },
      { label: "Removed", value: payload.diff.summary.removed },
      { label: "Changed", value: payload.diff.summary.changed },
      { label: "Total changes", value: payload.diff.summary.total },
    ],
    empty: payload.diff.entries.length === 0,
  };
}

export function createCaseBundleExportReviewPlan(payload: CaseBundle, fileName?: string): CaseBundleExportReviewPlan {
  const diffEntryCount = payload.compares.reduce((count, compare) => count + compare.entries.length, 0);
  return {
    kind: "caseBundle",
    title: "Case Bundle Export Review",
    actionLabel: "I reviewed what will be shared",
    payload,
    filename: fileName ?? `nlx-case-bundle-${payload.createdAt.replace(/[:]/g, "-")}.json`,
    included: [
      "share-safe run exports",
      "bundle metadata (schemaVersion, createdAt, guiBuildId)",
      "share-safe compare artifacts (if selected)",
    ],
    excluded: [
      "private case notes",
      "non-share-safe local settings",
      "raw run/session objects",
    ],
    counts: [
      { label: "Runs", value: payload.runs.length },
      { label: "Compare artifacts", value: payload.compares.length },
      { label: "Diff entries", value: diffEntryCount },
    ],
    empty: payload.runs.length === 0,
  };
}

export function buildExportReviewOutput(plan: ExportReviewPlan): string {
  if (plan.kind === "run") {
    return buildShareSafeRunExportJsonFromPayload(plan.payload);
  }
  if (plan.kind === "diff") {
    return buildRunHistoryShareSafeDiffCopyText(plan.payload);
  }
  return buildCaseBundleJson(plan.payload);
}
