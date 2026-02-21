import { buildDiagnosticsPayload, buildDiagnosticsText } from "../diagnosticsPayload";

describe("diagnosticsPayload helpers", () => {
  it("builds deterministic payload fields", () => {
    const payload = buildDiagnosticsPayload({
      guiBuild: "phase10",
      userAgent: "Mozilla/5.0",
      readOnly: true,
      highContrast: false,
      reducedMotion: true,
      sessionCount: 12,
      pinnedCount: 3,
      activeView: "output",
      selectedSessionId: "session-123",
    });

    expect(payload).toEqual({
      guiBuild: "phase10",
      userAgent: "Mozilla/5.0",
      flags: {
        readOnly: true,
        highContrast: false,
        reducedMotion: true,
      },
      sessions: {
        total: 12,
        pinned: 3,
      },
      selection: {
        view: "output",
        sessionId: "session-123",
      },
    });
  });

  it("builds copy-ready diagnostics text without output fields", () => {
    const text = buildDiagnosticsText({
      guiBuild: "phase10",
      userAgent: "Mozilla/5.0",
      readOnly: true,
      highContrast: true,
      reducedMotion: false,
      sessionCount: 1,
      pinnedCount: 0,
      activeView: "tasks",
      selectedSessionId: null,
    });

    expect(text).toContain("guiBuild=phase10");
    expect(text).toContain("view=tasks");
    expect(text).toContain("selectedSessionId=none");
    expect(text).not.toContain("stdout");
    expect(text).not.toContain("stderr");
  });
});
