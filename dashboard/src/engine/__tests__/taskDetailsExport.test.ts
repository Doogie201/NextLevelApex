import { buildTaskDetailsSummary } from "../taskDetailsExport";

describe("taskDetailsExport", () => {
  it("formats task details with stable fields", () => {
    const text = buildTaskDetailsSummary({
      taskName: "Cloudflared",
      status: "PASS",
      reason: "DoH listener healthy.",
      lastRunAt: "2026-02-21T22:00:00Z",
    });

    expect(text).toContain("Task: Cloudflared");
    expect(text).toContain("Status: PASS");
    expect(text).toContain("Last run: 2026-02-21T22:00:00Z");
    expect(text).toContain("Reason: DoH listener healthy.");
  });

  it("redacts sensitive-looking values in reason and snippet", () => {
    const text = buildTaskDetailsSummary({
      taskName: "Security",
      status: "FAIL",
      reason: "WEBPASSWORD=super-secret-value",
      outputSnippet: "token=abcdefghijklmnopqrstuvwxyz123456 /Users/me/.config/secret/path",
    });

    expect(text).toContain("WEBPASSWORD=[REDACTED]");
    expect(text).toContain("token=[REDACTED]");
    expect(text).toContain("[REDACTED_PATH]");
    expect(text).not.toContain("super-secret-value");
  });
});
