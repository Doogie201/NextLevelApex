import { Copy } from "lucide-react";

import type { RunHistorySurfaceProps } from "../RunHistorySurface";

export type RunHistoryProvenancePanelProps = Pick<
  RunHistorySurfaceProps,
  "caseProvenance" | "copyCaseProvenance" | "formatTimestamp"
>;

export default function RunHistoryProvenancePanel({
  caseProvenance,
  copyCaseProvenance,
  formatTimestamp,
}: RunHistoryProvenancePanelProps) {
  if (!caseProvenance) {
    return null;
  }

  return (
    <section className="empty-state-card" aria-label="Case provenance">
      <div className="sessions-header">
        <h3>Provenance</h3>
        <div className="sessions-header-actions">
          <button
            className="btn-muted"
            type="button"
            onClick={() => void copyCaseProvenance()}
            aria-label="Copy case provenance text"
          >
            <Copy className="w-4 h-4" /> Copy Provenance
          </button>
        </div>
      </div>
      <dl className="inspector-grid">
        <div>
          <dt>Case</dt>
          <dd>{caseProvenance.caseLabel}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{caseProvenance.sourceLabel}</dd>
        </div>
        <div>
          <dt>Fingerprint</dt>
          <dd>{caseProvenance.fingerprint}</dd>
        </div>
        <div>
          <dt>Bundle schema</dt>
          <dd>{caseProvenance.bundleSchemaVersion}</dd>
        </div>
        <div>
          <dt>Library schema</dt>
          <dd>{caseProvenance.librarySchemaVersion ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatTimestamp(caseProvenance.createdAt)}</dd>
        </div>
        <div>
          <dt>Imported</dt>
          <dd>{caseProvenance.importedAt ? formatTimestamp(caseProvenance.importedAt) : "n/a"}</dd>
        </div>
        <div>
          <dt>Saved</dt>
          <dd>{caseProvenance.savedAt ? formatTimestamp(caseProvenance.savedAt) : "n/a"}</dd>
        </div>
        <div>
          <dt>Run count</dt>
          <dd>{caseProvenance.runCount}</dd>
        </div>
      </dl>
    </section>
  );
}
