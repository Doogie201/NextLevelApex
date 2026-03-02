import { detectWorktreeContext, type WorktreeContext, type ShellFn } from "./worktreeContext";

/** Patterns that indicate a raw Python traceback in stderr. */
export const TRACEBACK_PATTERNS: RegExp[] = [
  /Traceback \(most recent call last\)/i,
  /^\s+File ".*", line \d+/m,
  /ModuleNotFoundError:/,
  /ImportError:/,
  /FileNotFoundError:.*poetry/i,
  /No module named/,
];

const CANONICAL_FIX = "bash scripts/dev-setup.sh --repair-env";

export function containsTraceback(stderr: string): boolean {
  return TRACEBACK_PATTERNS.some((pattern) => pattern.test(stderr));
}

export interface SanitizedError {
  message: string;
  fixCommand: string;
  context: WorktreeContext;
  originalSuppressed: boolean;
}

export function sanitizeNlxError(
  errorType: string,
  stderr: string,
  shell?: ShellFn,
): SanitizedError {
  const context = detectWorktreeContext(shell);
  const hasTraceback = containsTraceback(stderr);

  if (errorType === "missing_nlx") {
    return {
      message:
        "nlx is not installed or not on PATH." +
        (context.isWorktree ? " You are running from a git worktree." : "") +
        ` Run: ${CANONICAL_FIX}`,
      fixCommand: CANONICAL_FIX,
      context,
      originalSuppressed: true,
    };
  }

  if (hasTraceback) {
    return {
      message:
        "nlx encountered a Python error." +
        (context.isWorktree ? " Worktree virtualenvs may need setup." : "") +
        ` Run: ${CANONICAL_FIX}`,
      fixCommand: CANONICAL_FIX,
      context,
      originalSuppressed: true,
    };
  }

  return {
    message: stderr,
    fixCommand: CANONICAL_FIX,
    context,
    originalSuppressed: false,
  };
}
