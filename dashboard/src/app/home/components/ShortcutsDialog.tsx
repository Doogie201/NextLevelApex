import { X } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

interface ShortcutsDialogProps {
  open: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onDialogKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export default function ShortcutsDialog({
  open,
  dialogRef,
  closeButtonRef,
  onClose,
  onDialogKeyDown,
}: ShortcutsDialogProps) {
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
        aria-labelledby="shortcut-dialog-title"
        onKeyDown={onDialogKeyDown}
      >
        <header className="shortcut-header">
          <h2 id="shortcut-dialog-title" className="section-title">
            Keyboard Shortcuts
          </h2>
          <button ref={closeButtonRef} className="btn-muted" type="button" onClick={onClose}>
            <X className="w-4 h-4" /> Close
          </button>
        </header>
        <ul className="shortcut-list">
          <li>
            <kbd>?</kbd>
            <span>Open shortcuts help</span>
          </li>
          <li>
            <kbd>Esc</kbd>
            <span>Close shortcuts help</span>
          </li>
          <li>
            <kbd>/</kbd>
            <span>Focus search (Output or Tasks view)</span>
          </li>
          <li>
            <kbd>g d</kbd>
            <span>Go to Dashboard</span>
          </li>
          <li>
            <kbd>g t</kbd>
            <span>Go to Tasks</span>
          </li>
          <li>
            <kbd>g o</kbd>
            <span>Go to Output</span>
          </li>
          <li>
            <kbd>↑ / ↓</kbd>
            <span>Navigate sessions (Output view)</span>
          </li>
          <li>
            <kbd>↑ / ↓ / Enter / Esc</kbd>
            <span>Navigate, open, and clear selection in Run History panel</span>
          </li>
          <li>
            <kbd>b / t</kbd>
            <span>Assign selected Run History row as Compare Base or Target (Compare mode)</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
