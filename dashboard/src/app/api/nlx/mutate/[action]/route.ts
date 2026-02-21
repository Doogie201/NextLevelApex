import { MUTATING_ACTIONS, isReadOnlyMode } from "@/engine/config";

export const runtime = "nodejs";

interface ParamsContext {
  params: Promise<{
    action: string;
  }>;
}

export async function POST(_request: Request, context: ParamsContext): Promise<Response> {
  const { action } = await context.params;
  if (!MUTATING_ACTIONS.has(action)) {
    return Response.json({ error: "Unknown mutating action." }, { status: 404 });
  }

  if (isReadOnlyMode()) {
    return Response.json(
      {
        error: `Action '${action}' is disabled in read-only mode.`,
      },
      { status: 403 },
    );
  }

  return Response.json(
    {
      error: `Action '${action}' is not implemented for GUI execution.`,
    },
    { status: 501 },
  );
}
