import { createRunSessionFromResult } from "../runSessions";
import { buildSessionCompareReportBundle, buildSessionReportBundle } from "../sessionReport";
import type { CommandResponse } from "../viewModel";

function buildResponse(overrides: Partial<CommandResponse> = {}): CommandResponse {
  return {
    ok: true,
    commandId: "dryRunTask",
    badge: "OK",
    reasonCode: "SUCCESS",
    exitCode: 0,
    timedOut: false,
    errorType: "none",
    stdout: "",
    stderr: "",
    events: [
      { ts: "2026-02-21T22:30:00.000Z", level: "info", msg: "starting task" },
      { ts: "2026-02-21T22:30:01.000Z", level: "warn", msg: "token=abcdef0123456789abcdef0123456789" },
    ],
    redacted: true,
    taskNames: [],
    taskResults: [{ taskName: "Security", status: "WARN", reason: "WEBPASSWORD=supersecret" }],
    diagnose: undefined,
    error: undefined,
    httpStatus: 200,
    ...overrides,
  };
}

describe("sessionReport", () => {
  it("builds deterministic session report bundles", () => {
    const session = createRunSessionFromResult({
      eventId: "evt-session",
      commandId: "dryRunTask",
      taskName: "Security",
      label: "Dry-Run Task: Security",
      note: "session note",
      startedAtMs: Date.parse("2026-02-21T22:30:00.000Z"),
      finishedAtIso: "2026-02-21T22:30:02.000Z",
      durationMs: 2000,
      result: buildResponse(),
    });

    const first = buildSessionReportBundle(session, "phase11");
    const second = buildSessionReportBundle(session, "phase11");

    expect(first).toEqual(second);
    expect(first.json).toContain('"schemaVersion": 1');
    expect(first.json).toContain('"reportType": "session"');
    expect(first.json).toContain("token=[REDACTED]");
    expect(first.markdown).toContain("# NextLevelApex Session Report");
  });

  it("builds deterministic compare report bundles", () => {
    const base = createRunSessionFromResult({
      eventId: "evt-base",
      commandId: "dryRunAll",
      label: "Dry-Run Sweep",
      note: "base",
      startedAtMs: Date.parse("2026-02-21T21:30:00.000Z"),
      finishedAtIso: "2026-02-21T21:30:02.000Z",
      durationMs: 2000,
      result: buildResponse({
        commandId: "dryRunAll",
        badge: "DEGRADED",
        reasonCode: "TIMEOUT",
        ok: false,
        errorType: "timeout",
      }),
    });

    const target = createRunSessionFromResult({
      eventId: "evt-target",
      commandId: "dryRunAll",
      label: "Dry-Run Sweep",
      note: "target",
      startedAtMs: Date.parse("2026-02-21T21:31:00.000Z"),
      finishedAtIso: "2026-02-21T21:31:03.000Z",
      durationMs: 3000,
      result: buildResponse({
        commandId: "dryRunAll",
        badge: "BROKEN",
        reasonCode: "EXEC_ERROR",
        ok: false,
        errorType: "spawn_error",
        events: [
          { ts: "2026-02-21T21:31:00.000Z", level: "error", msg: "dial tcp 8.8.8.8:53 failed" },
          { ts: "2026-02-21T21:31:01.000Z", level: "error", msg: "dial tcp 8.8.4.4:53 failed" },
        ],
      }),
    });

    const first = buildSessionCompareReportBundle(base, target, "phase11");
    const second = buildSessionCompareReportBundle(base, target, "phase11");

    expect(first).toEqual(second);
    expect(first.json).toContain('"reportType": "compare"');
    expect(first.markdown).toContain("# NextLevelApex Session Comparison Report");
    expect(first.markdown).toContain("New Errors Introduced");
  });
});
