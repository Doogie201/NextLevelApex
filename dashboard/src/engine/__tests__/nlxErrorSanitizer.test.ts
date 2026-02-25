import { containsTraceback, sanitizeNlxError, TRACEBACK_PATTERNS } from "../nlxErrorSanitizer";
import type { ShellFn } from "../worktreeContext";

const WORKTREE_SHELL: ShellFn = (cmd) => {
  if (cmd.includes("--show-toplevel")) return "/home/user/project";
  if (cmd.includes("--git-common-dir")) return "/home/user/project/.git";
  if (cmd.includes("--git-dir")) return "/home/user/.worktrees/project/wt/.git";
  if (cmd.includes("command -v python3")) return "/usr/bin/python3";
  if (cmd.includes("command -v nlx")) throw new Error("not found");
  if (cmd.includes("command -v python")) return "/usr/bin/python";
  return "";
};

const NON_WORKTREE_SHELL: ShellFn = (cmd) => {
  if (cmd.includes("--show-toplevel")) return "/home/user/project";
  if (cmd.includes("--git-common-dir")) return ".git";
  if (cmd.includes("--git-dir")) return ".git";
  if (cmd.includes("command -v python3")) return "/usr/bin/python3";
  if (cmd.includes("command -v nlx")) return "/usr/local/bin/nlx";
  return "";
};

describe("containsTraceback", () => {
  it("detects Python traceback header", () => {
    expect(containsTraceback("Traceback (most recent call last):")).toBe(true);
  });

  it("detects ModuleNotFoundError", () => {
    expect(containsTraceback("ModuleNotFoundError: No module named 'typer'")).toBe(true);
  });

  it("detects File line pattern", () => {
    expect(containsTraceback('  File "/usr/lib/python3.11/site.py", line 42')).toBe(true);
  });

  it("returns false for clean stderr", () => {
    expect(containsTraceback("Command completed successfully.")).toBe(false);
  });
});

describe("TRACEBACK_PATTERNS", () => {
  it("includes all expected patterns", () => {
    expect(TRACEBACK_PATTERNS.length).toBeGreaterThanOrEqual(6);
  });
});

describe("sanitizeNlxError", () => {
  it("AT-S19-02: suppresses traceback and provides canonical fix for missing_nlx", () => {
    const result = sanitizeNlxError("missing_nlx", "", WORKTREE_SHELL);

    expect(result.originalSuppressed).toBe(true);
    expect(result.message).toContain("nlx is not installed");
    expect(result.message).toContain("git worktree");
    expect(result.fixCommand).toBe("bash scripts/dev-setup.sh");
    expect(result.context.isWorktree).toBe(true);
  });

  it("AT-S19-02: suppresses Python traceback in stderr for nonzero_exit", () => {
    const traceback =
      "Traceback (most recent call last):\n" +
      '  File "/usr/lib/python3.11/runpy.py", line 198\n' +
      "ModuleNotFoundError: No module named 'nextlevelapex'";

    const result = sanitizeNlxError("nonzero_exit", traceback, WORKTREE_SHELL);

    expect(result.originalSuppressed).toBe(true);
    expect(result.message).toContain("Python error");
    expect(result.message).toContain("bash scripts/dev-setup.sh");
    expect(result.message).not.toContain("Traceback");
    expect(result.message).not.toContain("File \"/usr/lib");
  });

  it("passes through clean stderr without suppression", () => {
    const result = sanitizeNlxError("nonzero_exit", "DNS check failed.", NON_WORKTREE_SHELL);

    expect(result.originalSuppressed).toBe(false);
    expect(result.message).toBe("DNS check failed.");
  });

  it("AT-S19-04: includes worktree context in sanitized result", () => {
    const result = sanitizeNlxError("missing_nlx", "", WORKTREE_SHELL);

    expect(result.context.cwd).toBeDefined();
    expect(result.context.isWorktree).toBe(true);
    expect(result.context.interpreterPath).toBe("/usr/bin/python3");
  });

  it("omits worktree note when not in a worktree", () => {
    const result = sanitizeNlxError("missing_nlx", "", NON_WORKTREE_SHELL);

    expect(result.message).not.toContain("worktree");
    expect(result.message).toContain("bash scripts/dev-setup.sh");
  });
});
