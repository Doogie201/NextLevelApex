import { spawn } from "node:child_process";

export type CommandErrorType =
  | "missing_nlx"
  | "permission"
  | "timeout"
  | "aborted"
  | "spawn_error"
  | "nonzero_exit"
  | "none";

export interface CommandRunResult {
  argv: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
  errorType: CommandErrorType;
}

const MAX_CAPTURE_BYTES = 1024 * 1024;

function appendBounded(existing: string, chunk: Buffer): string {
  if (existing.length >= MAX_CAPTURE_BYTES) {
    return existing;
  }
  const incoming = chunk.toString("utf8");
  const remaining = MAX_CAPTURE_BYTES - existing.length;
  return existing + incoming.slice(0, remaining);
}

export async function runCommandArgv(
  argv: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandRunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const finalize = (payload: Omit<CommandRunResult, "argv" | "stdout" | "stderr">): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        argv,
        stdout,
        stderr,
        ...payload,
      });
    };

    const child = spawn(argv[0] ?? "", argv.slice(1), {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: process.env.PATH ?? "" },
    });

    const onAbort = (): void => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 200);
    };

    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 200);
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        finalize({ exitCode: 127, timedOut, aborted, errorType: "missing_nlx" });
        return;
      }
      if (error.code === "EACCES") {
        finalize({ exitCode: 126, timedOut, aborted, errorType: "permission" });
        return;
      }
      finalize({ exitCode: 1, timedOut, aborted, errorType: "spawn_error" });
    });

    child.on("close", (code) => {
      const exitCode = code ?? (timedOut ? 124 : 1);
      if (timedOut) {
        finalize({ exitCode, timedOut: true, aborted, errorType: "timeout" });
        return;
      }
      if (aborted) {
        finalize({ exitCode, timedOut: false, aborted: true, errorType: "aborted" });
        return;
      }
      if (exitCode !== 0) {
        finalize({ exitCode, timedOut: false, aborted: false, errorType: "nonzero_exit" });
        return;
      }
      finalize({ exitCode: 0, timedOut: false, aborted: false, errorType: "none" });
    });
  });
}
