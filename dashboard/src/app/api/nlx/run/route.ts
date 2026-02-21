import { buildRunEnvelope, type ApiBadge, type RunReasonCode } from "@/engine/apiContract";
import { AllowlistError, runAllowlistedNlxCommand } from "@/engine/nlxService";
import { CommandContractError, isCommandId, parseRunCommandRequest } from "@/engine/commandContract";

export const runtime = "nodejs";

const DEFAULT_ROUTE_TIMEOUT_MS = 60_000;
const MIN_ROUTE_TIMEOUT_MS = 1_000;

let activeRunCount = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getRouteTimeoutMs(): number {
  const raw = process.env.NLX_GUI_ROUTE_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ROUTE_TIMEOUT_MS;
  }
  return Math.max(MIN_ROUTE_TIMEOUT_MS, Math.floor(parsed));
}

function commandIdFromBody(body: unknown): string {
  if (!isRecord(body)) {
    return "unknown";
  }
  return typeof body.commandId === "string" ? body.commandId : "unknown";
}

function inferReasonForContractError(body: unknown, error: CommandContractError): RunReasonCode {
  const commandId = commandIdFromBody(body);
  if (commandId !== "unknown" && !isCommandId(commandId)) {
    return "NOT_ALLOWED";
  }
  if (/allowlisted/i.test(error.message)) {
    return "NOT_ALLOWED";
  }
  return "VALIDATION";
}

function buildHandledResponse(input: {
  ok: boolean;
  badge: ApiBadge;
  reasonCode: RunReasonCode;
  commandId: string;
  startedAt?: string;
  stdout?: string;
  stderr?: string;
  events?: Array<{ ts: string; level: "debug" | "info" | "warn" | "error"; msg: string }>;
  taskNames?: Awaited<ReturnType<typeof runAllowlistedNlxCommand>>["taskNames"];
  taskResults?: Awaited<ReturnType<typeof runAllowlistedNlxCommand>>["taskResults"];
  diagnose?: Awaited<ReturnType<typeof runAllowlistedNlxCommand>>["diagnose"];
  exitCode?: number;
  timedOut?: boolean;
  errorType?: string;
}): Response {
  return Response.json(
    buildRunEnvelope({
      ok: input.ok,
      badge: input.badge,
      reasonCode: input.reasonCode,
      commandId: input.commandId,
      startedAt: input.startedAt,
      stdout: input.stdout,
      stderr: input.stderr,
      events: input.events,
      taskNames: input.taskNames,
      taskResults: input.taskResults,
      diagnose: input.diagnose,
      exitCode: input.exitCode,
      timedOut: input.timedOut,
      errorType: input.errorType,
    }),
    { status: 200 },
  );
}

function buildConflictPayload(commandId: string, startedAt: string): Response {
  return buildHandledResponse({
    ok: false,
    badge: "DEGRADED",
    reasonCode: "SINGLE_FLIGHT",
    commandId,
    startedAt,
    stderr: "A command is already running. Wait for completion or cancel the active run.",
    events: [
      {
        ts: new Date().toISOString(),
        level: "warn",
        msg: "Single-flight guard blocked a concurrent command request.",
      },
    ],
    exitCode: 1,
    timedOut: false,
    errorType: "spawn_error",
  });
}

function deriveSuccessBadge(result: Awaited<ReturnType<typeof runAllowlistedNlxCommand>>): ApiBadge {
  if (result.commandId === "diagnose" && result.diagnose) {
    return result.diagnose.badge;
  }
  if (result.taskResults?.some((task) => task.status === "FAIL")) {
    return "DEGRADED";
  }
  if (result.taskResults?.some((task) => task.status === "WARN" || task.status === "UNKNOWN")) {
    return "DEGRADED";
  }
  return "OK";
}

function deriveFailureReason(errorType: string): { badge: ApiBadge; reasonCode: RunReasonCode } {
  if (errorType === "timeout") {
    return { badge: "DEGRADED", reasonCode: "TIMEOUT" };
  }
  return { badge: "BROKEN", reasonCode: "EXEC_ERROR" };
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = new Date().toISOString();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return buildHandledResponse({
      ok: false,
      badge: "BROKEN",
      reasonCode: "VALIDATION",
      commandId: "unknown",
      startedAt,
      stderr: "Request body must be valid JSON.",
      events: [
        {
          ts: new Date().toISOString(),
          level: "error",
          msg: "Request body must be valid JSON.",
        },
      ],
      exitCode: 1,
      timedOut: false,
      errorType: "spawn_error",
    });
  }

  let parsed: ReturnType<typeof parseRunCommandRequest>;
  try {
    parsed = parseRunCommandRequest(body);
  } catch (error) {
    if (error instanceof CommandContractError) {
      const reasonCode = inferReasonForContractError(body, error);
      return buildHandledResponse({
        ok: false,
        badge: "BROKEN",
        reasonCode,
        commandId: commandIdFromBody(body),
        startedAt,
        stderr: error.message,
        events: [
          {
            ts: new Date().toISOString(),
            level: "error",
            msg: error.message,
          },
        ],
        exitCode: 1,
        timedOut: false,
        errorType: "spawn_error",
      });
    }
    return buildHandledResponse({
      ok: false,
      badge: "BROKEN",
      reasonCode: "VALIDATION",
      commandId: commandIdFromBody(body),
      startedAt,
      stderr: "Invalid command request.",
      events: [
        {
          ts: new Date().toISOString(),
          level: "error",
          msg: "Invalid command request.",
        },
      ],
      exitCode: 1,
      timedOut: false,
      errorType: "spawn_error",
    });
  }

  if (activeRunCount > 0) {
    return buildConflictPayload(parsed.commandId, startedAt);
  }

  activeRunCount += 1;

  const controller = new AbortController();
  let routeTimedOut = false;
  const timeout = setTimeout(() => {
    routeTimedOut = true;
    controller.abort();
  }, getRouteTimeoutMs());

  const abortFromClient = (): void => {
    controller.abort();
  };
  if (request.signal.aborted) {
    abortFromClient();
  } else {
    request.signal.addEventListener("abort", abortFromClient);
  }

  try {
    const result = await runAllowlistedNlxCommand(parsed.commandId, parsed.taskName, controller.signal);

    const normalizedResult =
      routeTimedOut && result.errorType === "aborted"
        ? {
            ...result,
            timedOut: true,
            errorType: "timeout" as const,
            exitCode: 124,
            stderr: result.stderr
              ? `${result.stderr}\nRoute timeout reached before command completion.`
              : "Route timeout reached before command completion.",
          }
        : result;

    if (!normalizedResult.ok) {
      const failure = deriveFailureReason(normalizedResult.errorType);
      return buildHandledResponse({
        ok: false,
        badge: failure.badge,
        reasonCode: failure.reasonCode,
        commandId: parsed.commandId,
        startedAt,
        stdout: normalizedResult.stdout,
        stderr: normalizedResult.stderr,
        events: [
          {
            ts: new Date().toISOString(),
            level: failure.reasonCode === "TIMEOUT" ? "warn" : "error",
            msg:
              failure.reasonCode === "TIMEOUT"
                ? "Command exceeded route timeout."
                : "Command execution failed.",
          },
        ],
        taskResults: normalizedResult.taskResults,
        taskNames: normalizedResult.taskNames,
        diagnose: normalizedResult.diagnose,
        exitCode: normalizedResult.exitCode,
        timedOut: normalizedResult.timedOut,
        errorType: normalizedResult.errorType,
      });
    }

    return buildHandledResponse({
      ok: true,
      badge: deriveSuccessBadge(normalizedResult),
      reasonCode: "SUCCESS",
      commandId: parsed.commandId,
      startedAt,
      stdout: normalizedResult.stdout,
      stderr: normalizedResult.stderr,
      events: [
        {
          ts: new Date().toISOString(),
          level: "info",
          msg: `Command ${parsed.commandId} completed.`,
        },
      ],
      taskResults: normalizedResult.taskResults,
      taskNames: normalizedResult.taskNames,
      diagnose: normalizedResult.diagnose,
      exitCode: normalizedResult.exitCode,
      timedOut: normalizedResult.timedOut,
      errorType: normalizedResult.errorType,
    });
  } catch (error) {
    if (error instanceof AllowlistError) {
      return buildHandledResponse({
        ok: false,
        badge: "BROKEN",
        reasonCode: "VALIDATION",
        commandId: parsed.commandId,
        startedAt,
        stderr: error.message,
        events: [
          {
            ts: new Date().toISOString(),
            level: "error",
            msg: error.message,
          },
        ],
        exitCode: 1,
        timedOut: false,
        errorType: "spawn_error",
      });
    }

    const message = error instanceof Error ? error.message : "Unknown command execution error.";
    const envelope = buildRunEnvelope({
      ok: false,
      badge: "BROKEN",
      reasonCode: routeTimedOut ? "TIMEOUT" : "UNKNOWN",
      commandId: parsed.commandId,
      startedAt,
      stderr: message,
      events: [
        {
          ts: new Date().toISOString(),
          level: "error",
          msg: message,
        },
      ],
      exitCode: 1,
      timedOut: routeTimedOut,
      errorType: routeTimedOut ? "timeout" : "spawn_error",
    });
    return Response.json(envelope, { status: 500 });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromClient);
    activeRunCount = Math.max(0, activeRunCount - 1);
  }
}
