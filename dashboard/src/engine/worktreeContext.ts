import { execSync } from "node:child_process";

export interface WorktreeContext {
  cwd: string;
  gitTopLevel: string | null;
  isWorktree: boolean;
  interpreterPath: string | null;
  nlxAvailable: boolean;
}

export type ShellFn = (cmd: string) => string;

const defaultShell: ShellFn = (cmd) =>
  execSync(cmd, { encoding: "utf-8", timeout: 3000 }).trim();

function safeShell(shell: ShellFn, cmd: string): string | null {
  try {
    return shell(cmd);
  } catch {
    return null;
  }
}

export function detectWorktreeContext(
  shell: ShellFn = defaultShell,
  cwd: string = process.cwd(),
): WorktreeContext {
  const gitTopLevel = safeShell(shell, "git rev-parse --show-toplevel");

  const commonDir = safeShell(shell, "git rev-parse --git-common-dir");
  const gitDir = safeShell(shell, "git rev-parse --git-dir");
  const isWorktree = commonDir !== null && gitDir !== null && commonDir !== gitDir;

  const interpreterPath =
    safeShell(shell, "command -v python3") ?? safeShell(shell, "command -v python");

  const nlxAvailable = safeShell(shell, "command -v nlx") !== null;

  return { cwd, gitTopLevel, isWorktree, interpreterPath, nlxAvailable };
}
