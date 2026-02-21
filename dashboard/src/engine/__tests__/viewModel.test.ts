import {
  classifyCommandOutcome,
  groupTaskResults,
  healthBadgeFromDiagnose,
  isStale,
  summarizeCommandResult,
  type CommandResponse,
} from "../viewModel";

function baseResponse(overrides: Partial<CommandResponse>): CommandResponse {
  return {
    ok: true,
    commandId: "diagnose",
    exitCode: 0,
    timedOut: false,
    errorType: "none",
    stdout: "",
    stderr: "",
    httpStatus: 200,
    diagnose: {
      summary: {
        dnsMode: "local-private",
        resolver: "192.168.64.2",
        pihole: "running",
        piholeUpstream: "host.docker.internal#5053",
        cloudflared: "ok",
        plaintextDns: "no",
        notes: "ok",
      },
      badge: "OK",
    },
    ...overrides,
  };
}

describe("view model helpers", () => {
  it("maps healthy diagnose output to PASS and OK", () => {
    const result = baseResponse({});
    expect(classifyCommandOutcome(result)).toBe("PASS");
    expect(healthBadgeFromDiagnose(result)).toBe("OK");
  });

  it("maps command failures to degraded and clear messages", () => {
    const result = baseResponse({
      ok: false,
      errorType: "missing_nlx",
      error: "command not found",
    });

    expect(classifyCommandOutcome(result)).toBe("FAIL");
    expect(healthBadgeFromDiagnose(result)).toBe("DEGRADED");
    expect(summarizeCommandResult(result)).toMatch(/nlx not found/i);
  });

  it("handles deterministic reason codes without optional payload fields", () => {
    const result = baseResponse({
      ok: false,
      commandId: "dryRunAll",
      badge: "DEGRADED",
      reasonCode: "SINGLE_FLIGHT",
      diagnose: undefined,
      taskResults: undefined,
      events: undefined,
    });

    expect(() => classifyCommandOutcome(result)).not.toThrow();
    expect(healthBadgeFromDiagnose(result)).toBe("DEGRADED");
    expect(summarizeCommandResult(result)).toMatch(/already running/i);
  });

  it("tolerates empty event arrays for timeline rendering paths", () => {
    const result = baseResponse({
      commandId: "dryRunAll",
      diagnose: undefined,
      events: [],
      taskResults: [],
    });

    expect(() => summarizeCommandResult(result)).not.toThrow();
    expect(classifyCommandOutcome(result)).toBe("PASS");
  });

  it("detects stale timestamps", () => {
    const now = Date.parse("2026-02-21T20:00:00.000Z");
    expect(isStale("2026-02-21T19:40:00.000Z", now, 10 * 60 * 1000)).toBe(true);
    expect(isStale("2026-02-21T19:59:00.000Z", now, 10 * 60 * 1000)).toBe(false);
  });

  it("groups mixed task lines by severity and task deterministically", () => {
    const grouped = groupTaskResults([
      { taskName: "Mise", status: "PASS", reason: "ok" },
      { taskName: "Cloudflared", status: "FAIL", reason: "timeout" },
      { taskName: "Cloudflared", status: "WARN", reason: "slow" },
      { taskName: "DNS Stack Sanity Check", status: "WARN", reason: "degraded" },
    ]);

    expect(grouped.bySeverity.map((entry) => entry.severity)).toEqual(["FAIL", "WARN", "PASS"]);
    expect(grouped.byTask.map((entry) => entry.taskName)).toEqual([
      "Cloudflared",
      "DNS Stack Sanity Check",
      "Mise",
    ]);
    expect(grouped.byTask[0]?.items.map((item) => item.status)).toEqual(["FAIL", "WARN"]);
  });
});
