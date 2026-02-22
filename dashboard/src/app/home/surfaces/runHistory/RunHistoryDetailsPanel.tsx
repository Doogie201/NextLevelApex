import { CheckCircle2, Copy, Download, FileJson2 } from "lucide-react";

import type { RunDetailsSection } from "@/engine/runShareSafeExport";
import type { RunHistorySurfaceProps } from "../RunHistorySurface";

export type RunHistoryDetailsPanelProps = Pick<
  RunHistorySurfaceProps,
  | "activeCaseLibraryEntry"
  | "activeCaseLibraryId"
  | "caseBundleMode"
  | "caseNotesDraft"
  | "errorDetailsPreview"
  | "formatTimestamp"
  | "inputDetailsPreview"
  | "outputDetailsPreview"
  | "renderedErrorDetailsText"
  | "renderedInputDetailsText"
  | "renderedOutputDetailsText"
  | "requestRunExportReview"
  | "runDetailsExpanded"
  | "runHistoryDetailsHeadingRef"
  | "runHistoryErrors"
  | "saveActiveCaseNotes"
  | "saveCurrentCaseToLibrary"
  | "selectedRunDetails"
  | "setCaseNotesDraft"
  | "toggleRunDetailsExpandedSection"
  | "copyRunDetailsSection"
>;

interface RunDetailsSectionBlockProps {
  section: RunDetailsSection;
  label: string;
  content: string;
  copyAction: () => void;
  copyDisabled?: boolean;
  truncated: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  emptyFallback?: string;
}

function RunDetailsSectionBlock({
  section,
  label,
  content,
  copyAction,
  copyDisabled = false,
  truncated,
  expanded,
  onToggleExpanded,
  emptyFallback,
}: RunDetailsSectionBlockProps) {
  return (
    <div className="inspector-section-block">
      <div className="sessions-header">
        <h4>{label}</h4>
        <div className="sessions-header-actions">
          <button className="copy-btn" type="button" onClick={copyAction} disabled={copyDisabled} aria-label={`Copy run ${section} details`}>
            <Copy className="w-4 h-4" /> Copy {label}
          </button>
          {truncated && (
            <button
              className="btn-muted"
              type="button"
              onClick={onToggleExpanded}
              aria-label={expanded ? `Collapse ${section} details` : `Expand ${section} details`}
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}
        </div>
      </div>
      {content.length > 0 ? <pre className="terminal-window">{content}</pre> : <p className="meta-muted">{emptyFallback}</p>}
    </div>
  );
}

export default function RunHistoryDetailsPanel({
  activeCaseLibraryEntry,
  activeCaseLibraryId,
  caseBundleMode,
  caseNotesDraft,
  errorDetailsPreview,
  formatTimestamp,
  inputDetailsPreview,
  outputDetailsPreview,
  renderedErrorDetailsText,
  renderedInputDetailsText,
  renderedOutputDetailsText,
  requestRunExportReview,
  runDetailsExpanded,
  runHistoryDetailsHeadingRef,
  runHistoryErrors,
  saveActiveCaseNotes,
  saveCurrentCaseToLibrary,
  selectedRunDetails,
  setCaseNotesDraft,
  toggleRunDetailsExpandedSection,
  copyRunDetailsSection,
}: RunHistoryDetailsPanelProps) {
  return (
    <>
      {caseBundleMode && (
        <section className="empty-state-card" aria-label="Case notes">
          <div className="sessions-header">
            <h3>Case Notes</h3>
            <div className="sessions-header-actions">
              <button
                className="btn-theme"
                type="button"
                onClick={saveActiveCaseNotes}
                disabled={!activeCaseLibraryId}
                aria-label="Save private case notes"
              >
                <CheckCircle2 className="w-4 h-4" /> Save Notes
              </button>
            </div>
          </div>
          {activeCaseLibraryEntry ? (
            <>
              <p className="meta-muted">
                Private notes for {activeCaseLibraryEntry.name}. Updated {" "}
                {activeCaseLibraryEntry.notesUpdatedAt ? formatTimestamp(activeCaseLibraryEntry.notesUpdatedAt) : "never"}. Notes are not
                included in default case bundle exports.
              </p>
              <textarea
                value={caseNotesDraft}
                onChange={(event) => setCaseNotesDraft(event.target.value)}
                rows={6}
                placeholder="Add private operator notes for this saved case."
                aria-label="Private case notes"
              />
            </>
          ) : (
            <div className="empty-state-card">
              <p className="meta-muted">Save this case to the local Case Library before adding private notes.</p>
              <button
                className="btn-muted"
                type="button"
                onClick={saveCurrentCaseToLibrary}
                aria-label="Save current case before adding notes"
              >
                <FileJson2 className="w-4 h-4" /> Save Case First
              </button>
            </div>
          )}
        </section>
      )}

      {selectedRunDetails && (
        <section className="empty-state-card" aria-label="Selected run details">
          <div className="sessions-header">
            <h3 ref={runHistoryDetailsHeadingRef} tabIndex={-1}>
              Run Details
            </h3>
            <div className="sessions-header-actions">
              <button className="btn-theme" type="button" onClick={requestRunExportReview} aria-label="Export selected run share-safe json">
                <Download className="w-4 h-4" /> Export Run
              </button>
            </div>
          </div>
          <dl className="inspector-grid">
            <div>
              <dt>Timestamp</dt>
              <dd>{formatTimestamp(selectedRunDetails.timestamp)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{selectedRunDetails.status}</dd>
            </div>
            <div>
              <dt>Run ID</dt>
              <dd>{selectedRunDetails.runId}</dd>
            </div>
            <div>
              <dt>Command</dt>
              <dd>{selectedRunDetails.commandId}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{selectedRunDetails.reasonCode}</dd>
            </div>
            <div>
              <dt>Bundle</dt>
              <dd>{selectedRunDetails.bundleId}</dd>
            </div>
          </dl>

          <RunDetailsSectionBlock
            section="input"
            label="Input"
            content={renderedInputDetailsText || "(no input summary available)"}
            copyAction={() => void copyRunDetailsSection("input")}
            truncated={Boolean(inputDetailsPreview?.truncated)}
            expanded={runDetailsExpanded.input}
            onToggleExpanded={() => toggleRunDetailsExpandedSection("input")}
            emptyFallback="(no input summary available)"
          />

          <RunDetailsSectionBlock
            section="output"
            label="Output"
            content={renderedOutputDetailsText || "(no output summary available)"}
            copyAction={() => void copyRunDetailsSection("output")}
            truncated={Boolean(outputDetailsPreview?.truncated)}
            expanded={runDetailsExpanded.output}
            onToggleExpanded={() => toggleRunDetailsExpandedSection("output")}
            emptyFallback="(no output summary available)"
          />

          <RunDetailsSectionBlock
            section="error"
            label="Error"
            content={selectedRunDetails.errorText.length > 0 ? renderedErrorDetailsText : ""}
            copyAction={() => void copyRunDetailsSection("error")}
            copyDisabled={selectedRunDetails.errorText.length === 0}
            truncated={Boolean(errorDetailsPreview?.truncated)}
            expanded={runDetailsExpanded.error}
            onToggleExpanded={() => toggleRunDetailsExpandedSection("error")}
            emptyFallback="No error output captured for this run."
          />
        </section>
      )}

      {runHistoryErrors.length > 0 && (
        <ul className="bundle-validation-list">
          {runHistoryErrors.map((error) => (
            <li key={`run-history-${error.code}-${error.path}-${error.message}`}>
              <strong>{error.code}</strong> <span>{error.path}</span> {error.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
