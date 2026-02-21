import { POST as mutatePost } from "../mutate/[action]/route";
import { POST as runPost } from "../run/route";

describe("nlx API routes", () => {
  const originalReadOnly = process.env.NLX_GUI_READ_ONLY;

  afterEach(() => {
    if (originalReadOnly === undefined) {
      delete process.env.NLX_GUI_READ_ONLY;
    } else {
      process.env.NLX_GUI_READ_ONLY = originalReadOnly;
    }
  });

  it("rejects non-allowlisted commands", async () => {
    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "autofix" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/allowlisted/i);
  });

  it("blocks mutation routes in read-only mode", async () => {
    process.env.NLX_GUI_READ_ONLY = "true";
    const request = new Request("http://localhost/api/nlx/mutate/reset", {
      method: "POST",
    });

    const response = await mutatePost(request, { params: Promise.resolve({ action: "reset" }) });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/disabled in read-only mode/i);
  });
});
