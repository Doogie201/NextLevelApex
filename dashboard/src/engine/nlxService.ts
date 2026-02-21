import {
  AllowlistError,
  buildCommandSpec,
  ensureTaskIsDiscovered,
  parseTaskNamesFromListTasks,
  validateTaskNameFormat,
} from "./allowlist";
import { classifyDiagnose, parseDiagnoseLine, type DiagnoseSummary, type HealthBadge } from "./diagnose";
import { redactOutput } from "./redaction";
import { runCommandArgv, type CommandErrorType } from "./runner";
import { parseTaskResults, type TaskResult } from "./taskResults";

export interface NlxCommandResponse {
  ok: boolean;
  commandId: string;
  exitCode: number;
  timedOut: boolean;
  errorType: CommandErrorType;
  stdout: string;
  stderr: string;
  taskNames?: string[];
  taskResults?: TaskResult[];
  diagnose?: {
    summary: DiagnoseSummary;
    badge: HealthBadge;
  };
}

async function executeSpecWithFallback(
  argv: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<typeof runCommandArgv>>> {
  const candidates: string[][] = [argv];
  if (argv[0] === "nlx") {
    candidates.push(["poetry", "run", ...argv]);
  }

  let lastResult: Awaited<ReturnType<typeof runCommandArgv>> | null = null;

  for (const candidate of candidates) {
    const result = await runCommandArgv(candidate, timeoutMs, signal);
    lastResult = result;

    if (result.exitCode === 0) {
      return result;
    }

    if (result.errorType === "timeout" || result.errorType === "aborted") {
      return result;
    }
  }

  if (!lastResult) {
    throw new Error("No command candidates were executed.");
  }

  return lastResult;
}

async function listTasksInternal(): Promise<{ taskNames: string[] }> {
  const spec = buildCommandSpec("listTasks");
  const result = await executeSpecWithFallback(spec.argv, spec.timeoutMs);
  const stdout = redactOutput(result.stdout);
  if (result.exitCode !== 0) {
    throw new Error("Failed to list tasks from nlx.");
  }
  return { taskNames: parseTaskNamesFromListTasks(stdout) };
}

function toResponse(commandId: string, result: Awaited<ReturnType<typeof runCommandArgv>>): NlxCommandResponse {
  return {
    ok: result.exitCode === 0,
    commandId,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    errorType: result.errorType,
    stdout: redactOutput(result.stdout),
    stderr: redactOutput(result.stderr),
  };
}

export async function runAllowlistedNlxCommand(
  commandIdRaw: string,
  taskNameRaw?: string,
  signal?: AbortSignal,
): Promise<NlxCommandResponse> {
  const taskName = taskNameRaw?.trim();
  const spec = buildCommandSpec(commandIdRaw, taskName);

  if (spec.commandId === "dryRunTask") {
    const normalizedTask = validateTaskNameFormat(taskName ?? "");
    const discovered = await listTasksInternal();
    ensureTaskIsDiscovered(normalizedTask, discovered.taskNames);
  }

  const runResult = await executeSpecWithFallback(spec.argv, spec.timeoutMs, signal);
  const response = toResponse(spec.commandId, runResult);

  if (spec.commandId === "listTasks") {
    response.taskNames = parseTaskNamesFromListTasks(response.stdout);
  }

  if (spec.commandId === "diagnose" && response.ok) {
    try {
      const firstLine = response.stdout.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
      const summary = parseDiagnoseLine(firstLine);
      response.diagnose = {
        summary,
        badge: classifyDiagnose(summary),
      };
    } catch {
      response.ok = false;
      response.errorType = "spawn_error";
      response.stderr = response.stderr
        ? `${response.stderr}\nDiagnose output parsing failed.`
        : "Diagnose output parsing failed.";
    }
  }

  if ((spec.commandId === "dryRunAll" || spec.commandId === "dryRunTask") && response.ok) {
    response.taskResults = parseTaskResults(response.stdout);
  }

  return response;
}

export { AllowlistError };
