import {
  classifyCommandOutcome,
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

  it("detects stale timestamps", () => {
    const now = Date.parse("2026-02-21T20:00:00.000Z");
    expect(isStale("2026-02-21T19:40:00.000Z", now, 10 * 60 * 1000)).toBe(true);
    expect(isStale("2026-02-21T19:59:00.000Z", now, 10 * 60 * 1000)).toBe(false);
  });
});
