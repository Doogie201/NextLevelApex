import { Search, Trash2 } from "lucide-react";

import { buildRunHistoryCountLabel } from "./runHistoryViewModel";
import type { RunHistorySurfaceProps } from "../RunHistorySurface";

type RunHistoryStatusValue = RunHistorySurfaceProps["runHistoryStatusFilter"];
type RunHistorySortValue = RunHistorySurfaceProps["runHistorySortOrder"];

export type RunHistoryNoticesAndFiltersProps = Pick<
  RunHistorySurfaceProps,
  | "activeRunHistoryRows"
  | "caseLibraryEntries"
  | "caseLibraryNotice"
  | "caseModeNotice"
  | "clearStoredCaseLibraryImmediately"
  | "clearStoredRunHistoryImmediately"
  | "runHistoryPersistenceNotice"
  | "runHistoryQuery"
  | "runHistorySearchInputRef"
  | "runHistorySortOrder"
  | "runHistoryStatusFilter"
  | "runHistoryTotalCount"
  | "setCaseLibraryNotice"
  | "setCaseModeNotice"
  | "setRunHistoryPersistenceNotice"
  | "setRunHistoryQuery"
  | "setRunHistorySortOrder"
  | "setRunHistoryStatusFilter"
>;

export default function RunHistoryNoticesAndFilters({
  activeRunHistoryRows,
  caseLibraryEntries,
  caseLibraryNotice,
  caseModeNotice,
  clearStoredCaseLibraryImmediately,
  clearStoredRunHistoryImmediately,
  runHistoryPersistenceNotice,
  runHistoryQuery,
  runHistorySearchInputRef,
  runHistorySortOrder,
  runHistoryStatusFilter,
  runHistoryTotalCount,
  setCaseLibraryNotice,
  setCaseModeNotice,
  setRunHistoryPersistenceNotice,
  setRunHistoryQuery,
  setRunHistorySortOrder,
  setRunHistoryStatusFilter,
}: RunHistoryNoticesAndFiltersProps) {
  return (
    <>
      {runHistoryPersistenceNotice && (
        <div className="empty-state-card" aria-live="polite" aria-label="Run history persistence notice">
          <p className="meta-muted">{runHistoryPersistenceNotice}</p>
          <div className="sessions-header-actions">
            <button
              className="btn-muted"
              type="button"
              onClick={clearStoredRunHistoryImmediately}
              aria-label="Clear stored run history"
            >
              <Trash2 className="w-4 h-4" /> Clear Stored History
            </button>
            <button
              className="btn-muted"
              type="button"
              onClick={() => setRunHistoryPersistenceNotice(null)}
              aria-label="Dismiss run history notice"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {caseModeNotice && (
        <div className="empty-state-card" aria-live="polite" aria-label="Case mode notice">
          <p className="meta-muted">{caseModeNotice}</p>
          <div className="sessions-header-actions">
            <button className="btn-muted" type="button" onClick={() => setCaseModeNotice(null)} aria-label="Dismiss case mode notice">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {caseLibraryNotice && (
        <div className="empty-state-card" aria-live="polite" aria-label="Case library notice">
          <p className="meta-muted">{caseLibraryNotice}</p>
          <div className="sessions-header-actions">
            <button
              className="btn-muted"
              type="button"
              onClick={clearStoredCaseLibraryImmediately}
              disabled={caseLibraryEntries.length === 0}
              aria-label="Clear stored case library"
            >
              <Trash2 className="w-4 h-4" /> Clear Stored Cases
            </button>
            <button
              className="btn-muted"
              type="button"
              onClick={() => setCaseLibraryNotice(null)}
              aria-label="Dismiss case library notice"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="output-controls">
        <label className="search-control" aria-label="Search run history">
          <Search className="w-4 h-4" />
          <input
            ref={runHistorySearchInputRef}
            type="search"
            placeholder="Search history label or output preview"
            value={runHistoryQuery}
            onChange={(event) => setRunHistoryQuery(event.target.value)}
            aria-label="Search run history text"
          />
        </label>
        <label className="select-control" aria-label="Filter run history status">
          <span>Status</span>
          <select
            value={runHistoryStatusFilter}
            onChange={(event) => setRunHistoryStatusFilter(event.target.value as RunHistoryStatusValue)}
            aria-label="Run history status filter"
          >
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label className="select-control" aria-label="Sort run history by time">
          <span>Order</span>
          <select
            value={runHistorySortOrder}
            onChange={(event) => setRunHistorySortOrder(event.target.value as RunHistorySortValue)}
            aria-label="Run history time order"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>
      <p className="meta-muted" aria-live="polite">
        {buildRunHistoryCountLabel(activeRunHistoryRows.length, runHistoryTotalCount)}
      </p>
    </>
  );
}
