import { AllowlistError, runAllowlistedNlxCommand } from "@/engine/nlxService";
import { CommandContractError, parseRunCommandRequest } from "@/engine/commandContract";

export const runtime = "nodejs";

const DEFAULT_ROUTE_TIMEOUT_MS = 60_000;
const MIN_ROUTE_TIMEOUT_MS = 1_000;

let activeRunCount = 0;

function getRouteTimeoutMs(): number {
  const raw = process.env.NLX_GUI_ROUTE_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ROUTE_TIMEOUT_MS;
  }
  return Math.max(MIN_ROUTE_TIMEOUT_MS, Math.floor(parsed));
}

function buildConflictPayload(commandId: string): {
  ok: boolean;
  commandId: string;
  exitCode: number;
  timedOut: boolean;
  errorType: "spawn_error";
  stdout: string;
  stderr: string;
  error: string;
  degraded: true;
} {
  return {
    ok: false,
    commandId,
    exitCode: 1,
    timedOut: false,
    errorType: "spawn_error",
    stdout: "",
    stderr: "A command is already running. Wait for completion or cancel the active run.",
    error: "A command is already running. Wait for completion or cancel the active run.",
    degraded: true,
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  let parsed: ReturnType<typeof parseRunCommandRequest>;
  try {
    parsed = parseRunCommandRequest(body);
  } catch (error) {
    if (error instanceof CommandContractError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "Invalid command request." }, { status: 400 });
  }

  if (activeRunCount > 0) {
    return Response.json(buildConflictPayload(parsed.commandId), { status: 409 });
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
      if (normalizedResult.errorType === "timeout") {
        return Response.json({ ...normalizedResult, degraded: true }, { status: 504 });
      }
      if (normalizedResult.errorType === "aborted") {
        return Response.json({ ...normalizedResult, degraded: true }, { status: 499 });
      }
      return Response.json(normalizedResult, { status: 502 });
    }

    return Response.json(normalizedResult, { status: 200 });
  } catch (error) {
    if (error instanceof AllowlistError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown command execution error.";
    return Response.json(
      {
        ok: false,
        commandId: parsed.commandId,
        exitCode: 1,
        timedOut: routeTimedOut,
        errorType: routeTimedOut ? "timeout" : "spawn_error",
        stdout: "",
        stderr: message,
        error: message,
        degraded: true,
      },
      { status: routeTimedOut ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromClient);
    activeRunCount = Math.max(0, activeRunCount - 1);
  }
}
