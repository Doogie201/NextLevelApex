import { Copy, Download, Trash2, X } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

interface ConsoleHelpDialogProps {
  open: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onDialogKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onCopyDiagnostics: () => void | Promise<void>;
  onExportSettings: () => void;
  onClearSettings: () => void;
}

export default function ConsoleHelpDialog({
  open,
  dialogRef,
  closeButtonRef,
  onClose,
  onDialogKeyDown,
  onCopyDiagnostics,
  onExportSettings,
  onClearSettings,
}: ConsoleHelpDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="shortcut-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="shortcut-dialog glass-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="console-help-title"
        onKeyDown={onDialogKeyDown}
      >
        <header className="shortcut-header">
          <h2 id="console-help-title" className="section-title">
            Console Help
          </h2>
          <button ref={closeButtonRef} className="btn-muted" type="button" onClick={onClose}>
            <X className="w-4 h-4" /> Close
          </button>
        </header>

        <div className="help-body">
          <section className="help-section">
            <h3>How Runs Work</h3>
            <ul className="shortcut-list">
              <li>
                <span>Single-flight: only one command can run at a time. Additional requests return busy guidance.</span>
              </li>
              <li>
                <span>Timeouts map to DEGRADED so the UI stays deterministic without crashing.</span>
              </li>
              <li>
                <span>Outputs shown and exported from the GUI are redacted before render and persistence.</span>
              </li>
            </ul>
          </section>

          <section className="help-section">
            <h3>Local Storage</h3>
            <p className="meta-muted">
              Sessions are stored in browser localStorage for quick restore. Use clear controls below to reset local GUI state.
            </p>
            <div className="settings-actions">
              <button className="btn-muted" type="button" onClick={() => void onCopyDiagnostics()}>
                <Copy className="w-4 h-4" /> Copy Diagnostics
              </button>
              <button className="btn-muted" type="button" onClick={onExportSettings}>
                <Download className="w-4 h-4" /> Export Settings
              </button>
              <button className="btn-muted" type="button" onClick={onClearSettings}>
                <Trash2 className="w-4 h-4" /> Clear Settings
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
