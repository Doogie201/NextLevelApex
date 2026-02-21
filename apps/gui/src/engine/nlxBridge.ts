import { buildAllowlistedArgv } from "./allowlist";
import { redactOutput } from "./redaction";
import type { CommandArgs, CommandExecutionResult, CommandId, RunnerResponse } from "./types";

export interface CommandRunner {
  run(argv: string[], timeoutMs: number, signal?: AbortSignal): Promise<RunnerResponse>;
}

export async function runCommand(
  commandId: CommandId,
  args: CommandArgs,
  runner: CommandRunner,
  timeoutMs = 4500,
  signal?: AbortSignal,
): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  let argv: string[];

  try {
    argv = buildAllowlistedArgv(commandId, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Disallowed command";
    return {
      commandId,
      argv: [],
      stdout: "",
      stderr: redactOutput(message),
      exitCode: 124,
      timedOut: false,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const response = await runner.run(argv, timeoutMs, signal);
    return {
      commandId,
      argv,
      stdout: redactOutput(response.stdout),
      stderr: redactOutput(response.stderr),
      exitCode: response.exitCode,
      timedOut: false,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown command failure";
    const timedOut = message.toLowerCase().includes("timeout");

    return {
      commandId,
      argv,
      stdout: "",
      stderr: redactOutput(message),
      exitCode: 124,
      timedOut,
      durationMs: Date.now() - startedAt,
    };
  }
}
