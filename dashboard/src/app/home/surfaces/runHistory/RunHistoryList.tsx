import { Link2, ListChecks, Pin, PinOff, Play } from "lucide-react";

import { getRunHistoryBadgeClass, getRunHistoryListDisplayState } from "./runHistoryViewModel";
import type { RunHistorySurfaceProps } from "../RunHistorySurface";

export type RunHistoryListProps = Pick<
  RunHistorySurfaceProps,
  | "activeRunHistoryRows"
  | "assignRunHistoryCompareRole"
  | "formatTimestamp"
  | "isBusy"
  | "loadRunHistoryIntoEditor"
  | "pinRunHistoryAsSavedView"
  | "replayRunHistory"
  | "resetRunHistoryFilters"
  | "runHistoryCompareSelection"
  | "runHistoryRowId"
  | "runHistoryTotalCount"
  | "selectedRunHistoryRow"
  | "setSelectedRunHistoryId"
  | "toggleRunHistoryPinnedState"
>;

export default function RunHistoryList({
  activeRunHistoryRows,
  assignRunHistoryCompareRole,
  formatTimestamp,
  isBusy,
  loadRunHistoryIntoEditor,
  pinRunHistoryAsSavedView,
  replayRunHistory,
  resetRunHistoryFilters,
  runHistoryCompareSelection,
  runHistoryRowId,
  runHistoryTotalCount,
  selectedRunHistoryRow,
  setSelectedRunHistoryId,
  toggleRunHistoryPinnedState,
}: RunHistoryListProps) {
  const displayState = getRunHistoryListDisplayState(runHistoryTotalCount, activeRunHistoryRows.length);

  if (displayState === "empty") {
    return <p className="meta-muted">No replay bundles stored yet.</p>;
  }

  if (displayState === "filtered") {
    return (
      <div className="empty-state-card">
        <p className="meta-muted">No runs match your search/filters.</p>
        <div className="sessions-header-actions">
          <button
            className="btn-muted"
            type="button"
            onClick={resetRunHistoryFilters}
            aria-label="Reset run history search and filters"
          >
            Reset Filters
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sessions-list" role="list" aria-label="Run history list">
      {activeRunHistoryRows.map((entry) => {
        const isSelected = selectedRunHistoryRow?.id === entry.id;
        return (
          <div key={entry.id} className={`session-row ${isSelected ? "session-row-active" : ""}`} role="listitem">
            <button
              id={runHistoryRowId(entry.id)}
              type="button"
              className="session-row-button"
              onClick={() => setSelectedRunHistoryId(entry.id)}
              aria-label={`Select run history ${entry.bundleLabel}`}
              aria-pressed={isSelected}
            >
              <div className="session-row-heading">
                <span className={`status-pill ${getRunHistoryBadgeClass(entry.badge)}`}>{entry.badge ?? "N/A"}</span>
                {runHistoryCompareSelection.enabled && runHistoryCompareSelection.baseRunId === entry.id && (
                  <span className="status-pill status-warn">BASE</span>
                )}
                {runHistoryCompareSelection.enabled && runHistoryCompareSelection.targetRunId === entry.id && (
                  <span className="status-pill status-fail">TARGET</span>
                )}
                <strong>{entry.bundleLabel}</strong>
              </div>
              <div className="session-row-meta">
                <span>{entry.startedAt ? formatTimestamp(entry.startedAt) : "n/a"}</span>
                <span>{entry.commandId ?? "bundle-only"}</span>
                <span>{entry.bundleId}</span>
              </div>
            </button>
            <div className="sessions-export-center">
              <button
                className="btn-theme"
                type="button"
                onClick={() => void replayRunHistory(entry.id)}
                disabled={isBusy || entry.source === "case"}
                aria-label={`Replay run history ${entry.bundleLabel}`}
              >
                <Play className="w-4 h-4" /> Replay
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={() => loadRunHistoryIntoEditor(entry.id)}
                disabled={entry.source === "case"}
                aria-label={`Load run history ${entry.bundleLabel} into editor`}
              >
                <ListChecks className="w-4 h-4" /> Load Editor
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={() => void pinRunHistoryAsSavedView(entry.id)}
                disabled={entry.source === "case"}
                aria-label={`Pin ${entry.bundleLabel} as saved view`}
              >
                <Link2 className="w-4 h-4" /> Pin View
              </button>
              {runHistoryCompareSelection.enabled && (
                <>
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() => assignRunHistoryCompareRole("base", entry.id)}
                    aria-pressed={runHistoryCompareSelection.baseRunId === entry.id}
                    aria-label={`Set ${entry.bundleLabel} as compare base`}
                  >
                    Base
                  </button>
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() => assignRunHistoryCompareRole("target", entry.id)}
                    aria-pressed={runHistoryCompareSelection.targetRunId === entry.id}
                    aria-label={`Set ${entry.bundleLabel} as compare target`}
                  >
                    Target
                  </button>
                </>
              )}
              <button
                className="btn-muted session-pin-btn"
                type="button"
                onClick={() => toggleRunHistoryPinnedState(entry.id)}
                disabled={entry.source === "case"}
                aria-label={entry.pinned ? "Unpin run history entry" : "Pin run history entry"}
              >
                {entry.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
