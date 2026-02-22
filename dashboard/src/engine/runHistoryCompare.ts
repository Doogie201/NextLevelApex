import { buildBundleDiff, type BundleDiffResult } from "./bundleDiff";
import { buildShareSafeRunExport, type ShareSafeRunExport } from "./runShareSafeExport";
import type { RunHistoryEntry } from "./runHistoryStore";

export type RunHistoryCompareRole = "base" | "target";

export interface RunHistoryCompareSelection {
  enabled: boolean;
  baseRunId: string | null;
  targetRunId: string | null;
}

export interface RunHistoryShareSafeDiff {
  base: ShareSafeRunExport;
  target: ShareSafeRunExport;
  diff: BundleDiffResult;
}

const DIFF_COPY_SCHEMA = "run-history-share-safe-diff.v1";

function sortedUniqueRunIds(runIds: string[]): string[] {
  return Array.from(new Set(runIds.filter((runId) => runId.trim().length > 0)));
}

function firstDistinctTarget(runIds: string[], baseRunId: string | null): string | null {
  if (!baseRunId) {
    return runIds[0] ?? null;
  }
  return runIds.find((runId) => runId !== baseRunId) ?? null;
}

function normalizeSelection(
  selection: RunHistoryCompareSelection,
  availableRunIds: string[],
): RunHistoryCompareSelection {
  const validIds = sortedUniqueRunIds(availableRunIds);
  const validSet = new Set(validIds);

  let baseRunId = selection.baseRunId && validSet.has(selection.baseRunId) ? selection.baseRunId : null;
  let targetRunId = selection.targetRunId && validSet.has(selection.targetRunId) ? selection.targetRunId : null;

  if (baseRunId && targetRunId && baseRunId === targetRunId) {
    targetRunId = null;
  }

  if (!selection.enabled || validIds.length < 2) {
    return {
      enabled: false,
      baseRunId: null,
      targetRunId: null,
    };
  }

  if (!baseRunId) {
    baseRunId = validIds[0] ?? null;
  }
  if (!targetRunId) {
    targetRunId = firstDistinctTarget(validIds, baseRunId);
  }

  if (!baseRunId || !targetRunId || baseRunId === targetRunId) {
    return {
      enabled: false,
      baseRunId: null,
      targetRunId: null,
    };
  }

  return {
    enabled: true,
    baseRunId,
    targetRunId,
  };
}

export function createRunHistoryCompareSelection(): RunHistoryCompareSelection {
  return {
    enabled: false,
    baseRunId: null,
    targetRunId: null,
  };
}

export function canCompareRunHistory(availableRunIds: string[]): boolean {
  return sortedUniqueRunIds(availableRunIds).length >= 2;
}

export function setRunHistoryCompareMode(
  selection: RunHistoryCompareSelection,
  enabled: boolean,
  availableRunIds: string[],
): RunHistoryCompareSelection {
  if (!enabled) {
    return createRunHistoryCompareSelection();
  }
  return normalizeSelection({ ...selection, enabled: true }, availableRunIds);
}

export function sanitizeRunHistoryCompareSelection(
  selection: RunHistoryCompareSelection,
  availableRunIds: string[],
): RunHistoryCompareSelection {
  return normalizeSelection(selection, availableRunIds);
}

export function selectRunHistoryCompareRole(
  selection: RunHistoryCompareSelection,
  role: RunHistoryCompareRole,
  runId: string,
  availableRunIds: string[],
): RunHistoryCompareSelection {
  const normalized = normalizeSelection({ ...selection, enabled: true }, availableRunIds);
  if (!normalized.enabled) {
    return normalized;
  }

  const validIds = sortedUniqueRunIds(availableRunIds);
  if (!validIds.includes(runId)) {
    return normalized;
  }

  let baseRunId = normalized.baseRunId;
  let targetRunId = normalized.targetRunId;
  if (role === "base") {
    baseRunId = runId;
    if (targetRunId === baseRunId) {
      targetRunId = firstDistinctTarget(validIds, baseRunId);
    }
  } else {
    targetRunId = runId;
    if (baseRunId === targetRunId) {
      baseRunId = firstDistinctTarget(validIds, targetRunId);
    }
  }

  return normalizeSelection(
    {
      enabled: true,
      baseRunId,
      targetRunId,
    },
    validIds,
  );
}

export function swapRunHistoryCompareSelection(selection: RunHistoryCompareSelection): RunHistoryCompareSelection {
  if (!selection.enabled || !selection.baseRunId || !selection.targetRunId) {
    return selection;
  }
  return {
    enabled: true,
    baseRunId: selection.targetRunId,
    targetRunId: selection.baseRunId,
  };
}

export function buildRunHistoryShareSafeDiffFromExports(
  base: ShareSafeRunExport,
  target: ShareSafeRunExport,
): RunHistoryShareSafeDiff {
  return {
    base,
    target,
    diff: buildBundleDiff(base, target),
  };
}

export function buildRunHistoryShareSafeDiff(
  baseEntry: RunHistoryEntry,
  targetEntry: RunHistoryEntry,
): RunHistoryShareSafeDiff | null {
  const base = buildShareSafeRunExport(baseEntry);
  const target = buildShareSafeRunExport(targetEntry);
  if (!base || !target) {
    return null;
  }
  return buildRunHistoryShareSafeDiffFromExports(base, target);
}

export function buildRunHistoryShareSafeDiffCopyText(compare: RunHistoryShareSafeDiff): string {
  const lines: string[] = [
    `schema=${DIFF_COPY_SCHEMA}`,
    `baseRunId=${compare.base.runId}`,
    `targetRunId=${compare.target.runId}`,
    `baseBundleId=${compare.base.bundleId}`,
    `targetBundleId=${compare.target.bundleId}`,
    `summary.added=${compare.diff.summary.added}`,
    `summary.removed=${compare.diff.summary.removed}`,
    `summary.changed=${compare.diff.summary.changed}`,
    `summary.total=${compare.diff.summary.total}`,
    "changes:",
  ];

  if (compare.diff.entries.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }

  for (const entry of compare.diff.entries) {
    lines.push(`- kind=${entry.kind} path=${entry.path}`);
    if (entry.left !== undefined) {
      lines.push(`  left=${entry.left}`);
    }
    if (entry.right !== undefined) {
      lines.push(`  right=${entry.right}`);
    }
  }
  return lines.join("\n");
}
