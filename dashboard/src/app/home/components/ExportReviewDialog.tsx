import { CheckCircle2, X } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import { type ExportReviewPlan } from "@/engine/exportReview";

interface ExportReviewDialogProps {
  plan: ExportReviewPlan | null;
  dialogRef: RefObject<HTMLDivElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onDialogKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export default function ExportReviewDialog({
  plan,
  dialogRef,
  closeButtonRef,
  onClose,
  onConfirm,
  onDialogKeyDown,
}: ExportReviewDialogProps) {
  if (!plan) {
    return null;
  }

  return (
    <div className="shortcut-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="shortcut-dialog glass-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-review-title"
        onKeyDown={onDialogKeyDown}
      >
        <header className="shortcut-header">
          <h2 id="export-review-title" className="section-title">
            {plan.title}
          </h2>
          <button ref={closeButtonRef} className="btn-muted" type="button" onClick={onClose}>
            <X className="w-4 h-4" /> Close
          </button>
        </header>

        <div className="help-body">
          <section className="help-section">
            <h3>Included</h3>
            <ul className="shortcut-list">
              {plan.included.map((item) => (
                <li key={`included-${item}`}>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="help-section">
            <h3>Excluded</h3>
            <ul className="shortcut-list">
              {plan.excluded.map((item) => (
                <li key={`excluded-${item}`}>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="help-section">
            <h3>Summary</h3>
            <p className="meta-muted">Type: {plan.kind}</p>
            <p className="meta-muted">
              Destination: {plan.kind === "diff" ? "Clipboard (text)" : `${plan.filename ?? "export.txt"} (download)`}
            </p>
            <ul className="shortcut-list">
              {plan.counts.map((count) => (
                <li key={`${count.label}-${count.value}`}>
                  <span>
                    {count.label}: {count.value}
                  </span>
                </li>
              ))}
            </ul>
            {plan.empty && (
              <p className="meta-muted">This export is empty or contains only minimal data. Review before continuing.</p>
            )}
            <div className="settings-actions">
              <button className="btn-theme" type="button" onClick={() => void onConfirm()}>
                <CheckCircle2 className="w-4 h-4" /> {plan.actionLabel}
              </button>
              <button className="btn-muted" type="button" onClick={onClose}>
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
