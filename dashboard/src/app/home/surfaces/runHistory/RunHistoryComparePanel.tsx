import { Copy, X } from "lucide-react";

import { buildRunHistoryCompareSummary, buildRunHistoryDiffHeading, isRunHistoryDiffEntryLarge } from "./runHistoryViewModel";
import type { RunHistorySurfaceProps } from "../RunHistorySurface";

export type RunHistoryComparePanelProps = Pick<
  RunHistorySurfaceProps,
  | "clearRunHistoryCompare"
  | "compareBaseRunHistoryRow"
  | "compareTargetRunHistoryRow"
  | "requestRunHistoryCompareDiffExport"
  | "runHistoryCompareDiff"
  | "runHistoryCompareSelection"
  | "swapRunHistoryCompareRoles"
>;

export default function RunHistoryComparePanel({
  clearRunHistoryCompare,
  compareBaseRunHistoryRow,
  compareTargetRunHistoryRow,
  requestRunHistoryCompareDiffExport,
  runHistoryCompareDiff,
  runHistoryCompareSelection,
  swapRunHistoryCompareRoles,
}: RunHistoryComparePanelProps) {
  if (!runHistoryCompareSelection.enabled) {
    return null;
  }

  return (
    <section className="empty-state-card" aria-label="Run history compare">
      <div className="sessions-header">
        <h3>Compare Runs</h3>
        <div className="sessions-header-actions">
          <button
            className="btn-muted"
            type="button"
            onClick={swapRunHistoryCompareRoles}
            disabled={!runHistoryCompareSelection.baseRunId || !runHistoryCompareSelection.targetRunId}
            aria-label="Swap compare base and target runs"
          >
            Swap
          </button>
          <button
            className="btn-theme"
            type="button"
            onClick={requestRunHistoryCompareDiffExport}
            disabled={!runHistoryCompareDiff}
            aria-label="Copy share-safe run diff"
          >
            <Copy className="w-4 h-4" /> Copy Share-Safe Diff
          </button>
          <button
            className="btn-muted"
            type="button"
            onClick={clearRunHistoryCompare}
            aria-label="Exit compare mode and clear compare selections"
          >
            <X className="w-4 h-4" /> Exit
          </button>
        </div>
      </div>
      <p className="meta-muted">
        Base: {compareBaseRunHistoryRow?.bundleLabel ?? "none selected"} | Target: {" "}
        {compareTargetRunHistoryRow?.bundleLabel ?? "none selected"}
      </p>
      <p className="meta-muted">
        Keyboard: use arrow keys to select a row, then press <kbd>b</kbd> for Base, <kbd>t</kbd> for Target, and <kbd>Esc</kbd> to
        exit compare mode.
      </p>

      {!runHistoryCompareDiff ? (
        <p className="meta-muted">Select distinct Base and Target runs from the list to generate a share-safe diff.</p>
      ) : (
        <>
          <p className="meta-muted" aria-live="polite">
            {buildRunHistoryCompareSummary(runHistoryCompareDiff)}
          </p>
          {runHistoryCompareDiff.diff.entries.length > 0 && (
            <div className="sessions-header-actions">
              {runHistoryCompareDiff.diff.entries.slice(0, 24).map((entry, index) => (
                <button
                  key={`run-history-diff-jump-${entry.path}-${index}`}
                  className="btn-muted"
                  type="button"
                  onClick={() => {
                    if (typeof document === "undefined") {
                      return;
                    }
                    const target = document.getElementById(`run-history-diff-entry-${index}`);
                    if (target instanceof HTMLElement) {
                      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
                      target.focus();
                    }
                  }}
                  aria-label={`Jump to diff path ${entry.path}`}
                >
                  {entry.path}
                </button>
              ))}
            </div>
          )}
          {runHistoryCompareDiff.diff.entries.length === 0 ? (
            <p className="meta-muted">No differences between selected runs.</p>
          ) : (
            <div className="sessions-list" role="list" aria-label="Share-safe run diff entries">
              {runHistoryCompareDiff.diff.entries.map((entry, index) => {
                const heading = buildRunHistoryDiffHeading(entry.kind, entry.path);
                return (
                  <div
                    key={`run-history-diff-${entry.path}-${index}`}
                    id={`run-history-diff-entry-${index}`}
                    className="empty-state-card"
                    tabIndex={-1}
                    role="listitem"
                  >
                    {isRunHistoryDiffEntryLarge(entry.left, entry.right) ? (
                      <details>
                        <summary>{heading}</summary>
                        {entry.left !== undefined && <pre className="terminal-window">before: {entry.left}</pre>}
                        {entry.right !== undefined && <pre className="terminal-window">after: {entry.right}</pre>}
                      </details>
                    ) : (
                      <>
                        <p>
                          <strong>{heading}</strong>
                        </p>
                        {entry.left !== undefined && <pre className="terminal-window">before: {entry.left}</pre>}
                        {entry.right !== undefined && <pre className="terminal-window">after: {entry.right}</pre>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
