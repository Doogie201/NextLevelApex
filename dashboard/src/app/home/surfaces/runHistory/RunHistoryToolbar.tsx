import { ChevronRight, Download, FileJson2, Trash2, X } from "lucide-react";

import type { RunHistorySurfaceProps } from "../RunHistorySurface";

export type RunHistoryToolbarProps = Pick<
  RunHistorySurfaceProps,
  | "activeCaseLibraryEntry"
  | "activeRunHistoryRows"
  | "cancelRunHistoryClear"
  | "caseBundleImportInputRef"
  | "caseBundleMode"
  | "clearRunHistoryConfirmed"
  | "confirmRunHistoryClear"
  | "exitCaseMode"
  | "importCaseBundleFromFile"
  | "openCaseBundleImportPicker"
  | "requestCaseBundleExportReview"
  | "requestRunHistoryClear"
  | "runHistoryCanCompareEntries"
  | "runHistoryCompareSelection"
  | "runHistoryEntries"
  | "saveCurrentCaseToLibrary"
  | "toShortFingerprint"
  | "toggleRunHistoryCompareMode"
  | "caseModeFingerprint"
>;

export default function RunHistoryToolbar({
  activeCaseLibraryEntry,
  activeRunHistoryRows,
  cancelRunHistoryClear,
  caseBundleImportInputRef,
  caseBundleMode,
  clearRunHistoryConfirmed,
  confirmRunHistoryClear,
  exitCaseMode,
  importCaseBundleFromFile,
  openCaseBundleImportPicker,
  requestCaseBundleExportReview,
  requestRunHistoryClear,
  runHistoryCanCompareEntries,
  runHistoryCompareSelection,
  runHistoryEntries,
  saveCurrentCaseToLibrary,
  toShortFingerprint,
  toggleRunHistoryCompareMode,
  caseModeFingerprint,
}: RunHistoryToolbarProps) {
  return (
    <>
      <div className="sessions-header">
        <h3>Run History + Replay</h3>
        <div className="sessions-header-actions">
          <input
            ref={caseBundleImportInputRef}
            type="file"
            accept="application/json"
            className="sr-only"
            onChange={(event) => {
              void importCaseBundleFromFile(event);
            }}
            aria-label="Import case bundle file"
          />
          <button
            className={runHistoryCompareSelection.enabled ? "btn-theme" : "btn-muted"}
            type="button"
            onClick={toggleRunHistoryCompareMode}
            disabled={!runHistoryCanCompareEntries}
            aria-label={runHistoryCompareSelection.enabled ? "Exit compare mode" : "Enter compare mode"}
          >
            <ChevronRight className="w-4 h-4" /> {runHistoryCompareSelection.enabled ? "Exit Compare" : "Compare"}
          </button>
          <button
            className="btn-muted"
            type="button"
            onClick={saveCurrentCaseToLibrary}
            disabled={!caseBundleMode && activeRunHistoryRows.length === 0}
            aria-label="Save current case to local library"
          >
            <FileJson2 className="w-4 h-4" /> Save Current Case
          </button>
          <button
            className="btn-theme"
            type="button"
            onClick={requestCaseBundleExportReview}
            disabled={activeRunHistoryRows.length === 0}
            aria-label="Export case bundle from visible runs"
          >
            <Download className="w-4 h-4" /> Export Case Bundle
          </button>
          <button
            className="btn-muted"
            type="button"
            onClick={openCaseBundleImportPicker}
            aria-label="Import case bundle"
          >
            <FileJson2 className="w-4 h-4" /> Import Case Bundle
          </button>
          {caseBundleMode && (
            <button
              className="btn-muted"
              type="button"
              onClick={exitCaseMode}
              aria-label="Exit imported case mode"
            >
              <X className="w-4 h-4" /> Exit Case Mode
            </button>
          )}
          <button
            className="btn-muted"
            type="button"
            onClick={requestRunHistoryClear}
            disabled={caseBundleMode !== null || runHistoryEntries.length === 0 || confirmRunHistoryClear}
            aria-label="Clear run history bundles"
          >
            <Trash2 className="w-4 h-4" /> Clear
          </button>
          {confirmRunHistoryClear && (
            <>
              <button
                className="btn-theme"
                type="button"
                onClick={clearRunHistoryConfirmed}
                aria-label="Confirm clear run history bundles"
              >
                Confirm Clear
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={cancelRunHistoryClear}
                aria-label="Cancel clear run history bundles"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {caseBundleMode && (
        <p className="meta-muted">
          Case mode is active. Imported runs are read-only and session-only. Fingerprint: {" "}
          {caseModeFingerprint ? toShortFingerprint(caseModeFingerprint) : "n/a"}
          {activeCaseLibraryEntry ? ` | Library case: ${activeCaseLibraryEntry.name}` : ""}
        </p>
      )}
      {!runHistoryCanCompareEntries && <p className="meta-muted">Compare mode needs at least two visible runs.</p>}
      <p className="meta-muted">
        Stores share-safe bundle snapshots only. Replay runs immediately using validated configuration; Load hydrates inputs without
        starting a run.
      </p>
    </>
  );
}
