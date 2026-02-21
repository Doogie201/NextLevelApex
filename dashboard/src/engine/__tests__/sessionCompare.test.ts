import { createRunSessionFromResult } from "../runSessions";
import { compareRunSessions } from "../sessionCompare";
import type { CommandResponse } from "../viewModel";

function buildResponse(overrides: Partial<CommandResponse> = {}): CommandResponse {
  return {
    ok: false,
    commandId: "dryRunAll",
    badge: "DEGRADED",
    reasonCode: "TIMEOUT",
    exitCode: 1,
    timedOut: true,
    errorType: "timeout",
    stdout: "",
    stderr: "",
    events: [
      { ts: "2026-02-21T22:00:00.000Z", level: "info", msg: "started" },
      { ts: "2026-02-21T22:00:01.000Z", level: "warn", msg: "retrying upstream" },
      { ts: "2026-02-21T22:00:02.000Z", level: "error", msg: "dial tcp 8.8.8.8:53 failed" },
    ],
    redacted: true,
    taskNames: [],
    taskResults: [],
    diagnose: undefined,
    error: undefined,
    httpStatus: 200,
    ...overrides,
  };
}

describe("sessionCompare", () => {
  it("builds deterministic compare deltas and introduced errors", () => {
    const base = createRunSessionFromResult({
      eventId: "evt-base",
      commandId: "dryRunAll",
      label: "Dry-Run Sweep",
      note: "base",
      startedAtMs: Date.parse("2026-02-21T22:00:00.000Z"),
      finishedAtIso: "2026-02-21T22:00:03.000Z",
      durationMs: 3000,
      result: buildResponse(),
    });

    const target = createRunSessionFromResult({
      eventId: "evt-target",
      commandId: "dryRunAll",
      label: "Dry-Run Sweep",
      note: "target",
      startedAtMs: Date.parse("2026-02-21T23:00:00.000Z"),
      finishedAtIso: "2026-02-21T23:00:05.000Z",
      durationMs: 5000,
      result: buildResponse({
        events: [
          { ts: "2026-02-21T23:00:00.000Z", level: "info", msg: "started" },
          { ts: "2026-02-21T23:00:01.000Z", level: "warn", msg: "retrying upstream" },
          { ts: "2026-02-21T23:00:02.000Z", level: "error", msg: "dial tcp 8.8.8.8:53 failed" },
          { ts: "2026-02-21T23:00:03.000Z", level: "error", msg: "token=abcdef0123456789abcdef0123456789" },
        ],
      }),
    });

    const comparison = compareRunSessions(base, target);
    const secondPass = compareRunSessions(base, target);

    expect(secondPass).toEqual(comparison);
    expect(comparison.eventCount.delta).toBe(1);
    expect(comparison.severityCount.delta.ERROR).toBe(1);
    expect(comparison.newErrorsIntroduced).toHaveLength(1);
    expect(comparison.newErrorsIntroduced[0]?.message).toContain("token=[REDACTED]");
  });
});
