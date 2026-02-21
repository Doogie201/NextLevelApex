import { AllowlistError, runAllowlistedNlxCommand } from "@/engine/nlxService";
import { CommandContractError, parseRunCommandRequest } from "@/engine/commandContract";

export const runtime = "nodejs";

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

  try {
    const result = await runAllowlistedNlxCommand(parsed.commandId, parsed.taskName, request.signal);

    if (!result.ok) {
      const status = result.errorType === "timeout" ? 504 : result.errorType === "aborted" ? 499 : 502;
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
