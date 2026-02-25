import {
  detectWorktreeContext,
  normalizeGitPath,
  type ShellFn,
} from "../worktreeContext";

describe("normalizeGitPath", () => {
  it("resolves relative path against base", () => {
    const result = normalizeGitPath(".git", "/home/user/project");
    expect(result).toContain("home/user/project/.git");
  });

  it("returns absolute path unchanged (modulo normalize)", () => {
    const result = normalizeGitPath("/home/user/project/.git", "/ignored");
    expect(result).toContain("home/user/project/.git");
  });
});

describe("detectWorktreeContext", () => {
  it("AT-S19-01: detects worktree when git-common-dir differs from git-dir (after normalization)", () => {
    const shell: ShellFn = (cmd) => {
      if (cmd.includes("--show-toplevel")) return "/home/user/project";
      if (cmd.includes("--git-common-dir")) return "/home/user/project/.git";
      if (cmd.includes("--git-dir"))
        return "/home/user/.worktrees/project/wt1/.git";
      if (cmd.includes("command -v python3")) return "/usr/bin/python3";
      if (cmd.includes("command -v nlx")) return "/usr/local/bin/nlx";
      return "";
    };

    const ctx = detectWorktreeContext(shell, "/home/user/.worktrees/project/wt1");

    expect(ctx.cwd).toBe("/home/user/.worktrees/project/wt1");
    expect(ctx.gitTopLevel).toBe("/home/user/project");
    expect(ctx.isWorktree).toBe(true);
    expect(ctx.interpreterPath).toBe("/usr/bin/python3");
    expect(ctx.nlxAvailable).toBe(true);
  });

  it("AT-S19-01: no false worktree when relative and absolute paths resolve to the same .git", () => {
    // Simulates running from a subdirectory of a normal checkout where
    // git-common-dir returns ".git" (relative) and git-dir returns the
    // absolute path to the same .git directory.
    const shell: ShellFn = (cmd) => {
      if (cmd.includes("--show-toplevel")) return "/home/user/project";
      if (cmd.includes("--git-common-dir")) return ".git";
      if (cmd.includes("--git-dir")) return "/home/user/project/.git";
      if (cmd.includes("command -v python3")) return "/usr/bin/python3";
      if (cmd.includes("command -v nlx")) return "/usr/local/bin/nlx";
      return "";
    };

    const ctx = detectWorktreeContext(shell, "/home/user/project/src");

    expect(ctx.isWorktree).toBe(false);
  });

  it("detects non-worktree when git-common-dir equals git-dir (both relative)", () => {
    const shell: ShellFn = (cmd) => {
      if (cmd.includes("--show-toplevel")) return "/home/user/project";
      if (cmd.includes("--git-common-dir")) return ".git";
      if (cmd.includes("--git-dir")) return ".git";
      if (cmd.includes("command -v python3")) return "/usr/bin/python3";
      if (cmd.includes("command -v nlx")) throw new Error("not found");
      if (cmd.includes("command -v python")) return "/usr/bin/python";
      return "";
    };

    const ctx = detectWorktreeContext(shell, "/home/user/project");

    expect(ctx.isWorktree).toBe(false);
    expect(ctx.nlxAvailable).toBe(false);
  });

  it("handles missing git gracefully", () => {
    const shell: ShellFn = () => {
      throw new Error("command not found");
    };

    const ctx = detectWorktreeContext(shell, "/tmp/no-git");

    expect(ctx.gitTopLevel).toBeNull();
    expect(ctx.isWorktree).toBe(false);
    expect(ctx.interpreterPath).toBeNull();
    expect(ctx.nlxAvailable).toBe(false);
  });
});
