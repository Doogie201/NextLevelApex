import { isReadOnlyMode } from "@/engine/config";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json({ readOnly: isReadOnlyMode() });
}
