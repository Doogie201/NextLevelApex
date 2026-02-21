import { buildTimelineSummary, groupTimelineEvents } from "../timelineInsights";
import { createRunSessionFromResult } from "../runSessions";
import type { CommandEvent, CommandResponse } from "../viewModel";

function buildEvent(
  id: string,
  outcome: CommandEvent["outcome"],
  note: string,
  durationMs: number,
): CommandEvent {
  return {
    id,
    commandId: "dryRunAll",
    label: `Event ${id}`,
    startedAt: "2026-02-21T22:00:00.000Z",
    finishedAt: "2026-02-21T22:00:01.000Z",
    durationMs,
    outcome,
    note,
    stdout: "",
    stderr: "",
    taskResults: [],
  };
}

function buildResponse(overrides: Partial<CommandResponse> = {}): CommandResponse {
  return {
    ok: true,
    commandId: "dryRunAll",
    badge: "OK",
    reasonCode: "SUCCESS",
    exitCode: 0,
    timedOut: false,
    errorType: "none",
    stdout: "",
    stderr: "",
    events: [],
    redacted: true,
    taskNames: [],
    taskResults: [],
    diagnose: undefined,
    error: undefined,
    httpStatus: 200,
    ...overrides,
  };
}

describe("timelineInsights", () => {
  it("groups timeline entries by phase with deterministic order", () => {
    const events = [
      buildEvent("a", "PASS", "phase: bootstrap", 100),
      buildEvent("b", "FAIL", "phase: validation", 200),
      buildEvent("c", "WARN", "no phase marker", 300),
    ];
    const grouped = groupTimelineEvents(events, "phase");

    expect(grouped.map((group) => group.label)).toEqual(["bootstrap", "validation", "Ungrouped"]);
    expect(grouped[0]?.items[0]?.id).toBe("a");
  });

  it("builds deterministic timeline summary counts", () => {
    const events = [
      buildEvent("a", "PASS", "ok", 100),
      buildEvent("b", "WARN", "warn", 200),
      buildEvent("c", "FAIL", "fail", 300),
    ];

    const sessions = [
      createRunSessionFromResult({
        eventId: "evt-a",
        commandId: "dryRunAll",
        label: "Session A",
        note: "A",
        startedAtMs: Date.parse("2026-02-21T22:00:00.000Z"),
        finishedAtIso: "2026-02-21T22:00:01.000Z",
        durationMs: 1000,
        result: buildResponse({ badge: "OK", reasonCode: "SUCCESS" }),
      }),
      createRunSessionFromResult({
        eventId: "evt-b",
        commandId: "dryRunAll",
        label: "Session B",
        note: "B",
        startedAtMs: Date.parse("2026-02-21T22:01:00.000Z"),
        finishedAtIso: "2026-02-21T22:01:03.000Z",
        durationMs: 3000,
        result: buildResponse({ badge: "DEGRADED", reasonCode: "TIMEOUT", ok: false }),
      }),
    ];

    const summary = buildTimelineSummary(events, sessions);
    expect(summary.totalEvents).toBe(3);
    expect(summary.totalDurationMs).toBe(600);
    expect(summary.severityCounts.FAIL).toBe(1);
    expect(summary.badgeDistribution[0]).toEqual({ badge: "DEGRADED", count: 1 });
    expect(summary.reasonCodeDistribution[0]).toEqual({ reasonCode: "SUCCESS", count: 1 });
  });
});
