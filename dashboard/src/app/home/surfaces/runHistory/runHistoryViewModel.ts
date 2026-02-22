import type { RunHistoryShareSafeDiff } from "@/engine/runHistoryCompare";

import type { RunHistoryListRow } from "../RunHistorySurface";

export type RunHistoryListDisplayState = "empty" | "filtered" | "rows";

export function getRunHistoryBadgeClass(badge: RunHistoryListRow["badge"]): string {
  if (badge === "OK") {
    return "status-pass";
  }
  if (badge === "DEGRADED") {
    return "status-warn";
  }
  if (badge === "BROKEN") {
    return "status-fail";
  }
  return "status-skip";
}

export function getRunHistoryListDisplayState(totalCount: number, visibleCount: number): RunHistoryListDisplayState {
  if (totalCount === 0) {
    return "empty";
  }
  if (visibleCount === 0) {
    return "filtered";
  }
  return "rows";
}

export function buildRunHistoryCountLabel(visibleCount: number, totalCount: number): string {
  return `Showing ${visibleCount} of ${totalCount} run bundles.`;
}

export function buildRunHistoryCompareSummary(compareDiff: RunHistoryShareSafeDiff): string {
  return `Added ${compareDiff.diff.summary.added} | Removed ${compareDiff.diff.summary.removed} | Changed ${compareDiff.diff.summary.changed} | Total ${compareDiff.diff.summary.total}`;
}

export function buildRunHistoryDiffHeading(kind: string, path: string): string {
  return `${kind.toUpperCase()} ${path}`;
}

export function isRunHistoryDiffEntryLarge(left: string | undefined, right: string | undefined): boolean {
  const leftLength = left?.length ?? 0;
  const rightLength = right?.length ?? 0;
  return leftLength + rightLength > 280;
}
