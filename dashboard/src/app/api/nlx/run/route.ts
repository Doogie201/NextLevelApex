import { AllowlistError, runAllowlistedNlxCommand } from "@/engine/nlxService";

export const runtime = "nodejs";

interface RunBody {
  commandId?: string;
  taskName?: string;
}

function extractBody(input: unknown): RunBody {
  if (!input || typeof input !== "object") {
    return {};
  }
  const raw = input as Record<string, unknown>;
  return {
    commandId: typeof raw.commandId === "string" ? raw.commandId : undefined,
    taskName: typeof raw.taskName === "string" ? raw.taskName : undefined,
  };
}

export async function POST(request: Request): Promise<Response> {
  let parsed: RunBody;

  try {
    const body = await request.json();
    parsed = extractBody(body);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!parsed.commandId) {
    return Response.json({ error: "commandId is required." }, { status: 400 });
  }

  try {
    const result = await runAllowlistedNlxCommand(parsed.commandId, parsed.taskName);

    if (!result.ok) {
      const status = result.errorType === "timeout" ? 504 : 502;
      return Response.json(result, { status });
    }

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AllowlistError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown command execution error.";
    return Response.json({ error: message }, { status: 500 });
  }
}
